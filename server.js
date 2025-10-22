// server.js (ĐÃ SỬA LỖI DỨT ĐIỂM: Lọc file, Xóa thư mục, Tên folder)

const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const bodyParser = require('body-parser'); 

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CẤU HÌNH CLOUDINARY ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const ROOT_FOLDER = 'flutter_file_manager';

// Cấu hình multer
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: (req, file) => {
            return req.body.folder || ROOT_FOLDER; 
        }, 
        resource_type: 'auto', 
        public_id: (req, file) => {
            const baseName = file.originalname.split('.').slice(0, -1).join('.');
            return req.body.folder ? 
                   `${req.body.folder}/${baseName}` :
                   `${ROOT_FOLDER}/${baseName}`;
        }
    },
    overwrite: true,
});

const upload = multer({ storage: storage });

app.use(cors());
app.use(bodyParser.json()); 
app.use(express.text()); 

// --- HÀM HỖ TRỢ: LẤY TÊN FOLDER CUỐI CÙNG (CHÍNH XÁC) ---
function getCurrentFolderBasename(fullPath) {
    if (fullPath === ROOT_FOLDER) return null;
    
    const relativePath = fullPath.startsWith(`${ROOT_FOLDER}/`) 
        ? fullPath.substring(ROOT_FOLDER.length + 1)
        : fullPath;

    return relativePath.split('/').pop();
}


// === 1. GET: Lấy danh sách file và folder ===
app.get('/list', async (req, res) => {
    let currentFolder = req.query.folder || ROOT_FOLDER; 

    if (currentFolder.startsWith('/')) {
        currentFolder = currentFolder.substring(1);
    }
    
    // Cloudinary cần folder không có ký tự đặc biệt (chủ yếu là xử lý khoảng trắng trong tên folder)
    const sanitizedFolder = currentFolder.replace(/ /g, '_'); 

    try {
        // LẤY TẤT CẢ TÀI NGUYÊN BẮT ĐẦU BẰNG TIỀN TỐ NÀY (RECURSIVE)
        const fileResult = await cloudinary.api.resources({
            type: 'upload', 
            prefix: `${currentFolder}/`, 
            max_results: 50,
        });

        // Lấy danh sách các thư mục (folders) con
        const folderResult = await cloudinary.api.sub_folders(currentFolder);
        
        // SỬA LỖI LỌC FILE: Đảm bảo chỉ lấy file TRỰC TIẾP trong thư mục hiện tại
        const expectedFolderName = currentFolder.replace(`${ROOT_FOLDER}/`, '');
        const folderDepth = currentFolder.split('/').length;
        
        const fileList = fileResult.resources
            .filter(resource => {
                 // Kiểm tra nếu resource.public_id không chứa "/" ngoài tiền tố currentFolder
                 const relativeId = resource.public_id.substring(currentFolder.length + 1);
                 return relativeId.indexOf('/') === -1;
            })
            .map(resource => ({
                name: resource.public_id, 
                basename: resource.filename, 
                size: resource.bytes,
                url: resource.secure_url, 
                uploadDate: resource.created_at.split('T')[0],
                isFolder: false, 
            }));

        const folderList = folderResult.folders.map(folder => ({
            name: `${currentFolder}/${folder.name}`,
            basename: folder.name, 
            size: 0,
            url: '',
            uploadDate: new Date().toISOString().split('T')[0],
            isFolder: true, 
        }));
        
        const combinedList = [...folderList, ...fileList];

        res.status(200).json({
            currentFolder: currentFolder,
            items: combinedList
        });
    } catch (err) {
        console.error('Lỗi Cloudinary List:', err);
        if (err.http_code === 404) {
             return res.status(200).json({
                currentFolder: currentFolder,
                items: []
            });
        }
        res.status(500).json({ error: 'Lỗi server khi lấy danh sách file/folder.' });
    }
});

// === 2. POST: Tải file lên Cloudinary ===
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('Không có file nào được tải lên.');
    }
    
    res.status(201).json({ 
        message: `Tải/Ghi đè file ${req.file.originalname} thành công!`,
        file: {
            name: req.file.filename,
            size: req.file.size,
            url: req.file.path,
            uploadDate: new Date().toISOString().split('T')[0]
        }
    });
});

// === 3. POST: Tạo Thư mục Mới ===
app.post('/create-folder', async (req, res) => {
    const { folderPath } = req.body; 
    if (!folderPath) {
        return res.status(400).json({ error: 'Thiếu đường dẫn thư mục.' });
    }
    
    // Mã hóa folderPath để xử lý ký tự đặc biệt (trừ dấu /)
    const encodedFolderPath = folderPath.split('/').map(encodeURIComponent).join('/');

    try {
        const result = await cloudinary.api.create_folder(encodedFolderPath);
        
        if (result.success !== false) {
            const basename = folderPath.split('/').pop();
            const virtualFolder = {
                name: folderPath,
                basename: basename,
                size: 0,
                url: '',
                uploadDate: new Date().toISOString().split('T')[0],
                isFolder: true
            };
            return res.status(201).json({ message: `Đã tạo thư mục ${basename} thành công.`, folder: virtualFolder });
        } else {
            return res.status(409).json({ error: 'Thư mục có thể đã tồn tại hoặc lỗi không xác định.' });
        }
    } catch (err) {
        if (err.http_code === 400 && err.message.includes("already exists")) {
            return res.status(409).json({ error: 'Thư mục đã tồn tại.' });
        }
        console.error('Lỗi tạo thư mục:', err);
        return res.status(500).json({ error: 'Lỗi server khi tạo thư mục.' });
    }
});

// === 4. DELETE: Xóa Folder (FIXED: Xóa đệ quy) ===
app.delete('/delete-folder', async (req, res) => {
    const { folderPath } = req.body; 
    if (!folderPath) {
        return res.status(400).json({ error: 'Thiếu đường dẫn thư mục.' });
    }
    
    // Mã hóa folderPath để xử lý ký tự đặc biệt (trừ dấu /)
    const encodedFolderPath = folderPath.split('/').map(encodeURIComponent).join('/');

    try {
        // 1. Xóa tất cả file bên trong folder đó (RECURSIVE)
        await cloudinary.api.delete_resources_by_prefix(`${encodedFolderPath}/`);

        // 2. Xóa folder đó
        const result = await cloudinary.api.delete_folder(encodedFolderPath);

        if (result.message === 'Deleted' || result.deleted_counts > 0) {
            return res.status(200).json({ message: `Đã xóa thư mục ${folderPath} và tất cả nội dung thành công.` });
        } else {
            // Lỗi này giờ ít xảy ra hơn do đã xóa file bên trong
            return res.status(404).json({ error: 'Không tìm thấy thư mục hoặc lỗi khi xóa.' });
        }
    } catch (err) {
        console.error('Lỗi xóa thư mục:', err);
        if (err.http_code === 404) {
             return res.status(404).json({ error: 'Không tìm thấy thư mục hoặc lỗi khi xóa.' });
        }
        return res.status(500).json({ error: 'Lỗi server khi xóa thư mục.' });
    }
});

// === 5. DELETE: Xóa File (Sử dụng JSON body) ===
app.delete('/delete', async (req, res) => {
    const publicId = req.body.publicId; 
    
    if (!publicId) {
        return res.status(400).json({ error: 'Thiếu publicId để xóa.' });
    }
    
    try {
        const result = await cloudinary.uploader.destroy(publicId);

        if (result.result === 'ok') {
            return res.status(200).json({ message: `Đã xóa file ${publicId}` });
        } else {
            return res.status(500).json({ error: `Lỗi xóa file: ${result.result}` });
        }
    } catch (err) {
        return res.status(500).json({ error: 'Lỗi server khi xóa file.' });
    }
});


app.listen(PORT, () => {
    console.log(`Server Backend Cloudinary đang chạy tại cổng ${PORT}`);
});
