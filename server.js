// server.js (ĐÃ CẬP NHẬT: Hỗ trợ Cấu trúc Folder và GET /list theo Folder)

const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const bodyParser = require('body-parser'); // Dùng để đọc JSON/Text body

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CẤU HÌNH CLOUDINARY (LẤY TỪ BIẾN MÔI TRƯỜNG CỦA RENDER) ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const ROOT_FOLDER = 'flutter_file_manager';

// Cấu hình multer để lưu file vào Cloudinary
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        // Folder sẽ được định nghĩa động dựa trên request body
        folder: (req, file) => {
            return req.body.folder || ROOT_FOLDER; 
        }, 
        resource_type: 'auto', 
        public_id: (req, file) => {
            // Đảm bảo tên file không bị thay đổi ngẫu nhiên khi ghi đè
            return req.body.folder ? 
                   `${req.body.folder}/${file.originalname.split('.')[0]}` :
                   `${ROOT_FOLDER}/${file.originalname.split('.')[0]}`;
        }
    },
    overwrite: true,
});

const upload = multer({ storage: storage });

app.use(cors());
app.use(bodyParser.json()); // Dùng để đọc JSON body cho các request POST/DELETE
app.use(express.text()); 

// --- CÁC API ĐÃ CẬP NHẬT/BỔ SUNG ---

// === 1. GET: Lấy danh sách file và folder cho một đường dẫn cụ thể ===
app.get('/list', async (req, res) => {
    // Lấy tham số 'folder' từ query string, mặc định là folder gốc
    let currentFolder = req.query.folder || ROOT_FOLDER; 

    // Kiểm tra và đặt lại currentFolder nếu có ký tự không hợp lệ (ngăn chặn lỗi)
    if (currentFolder.startsWith('/')) {
        currentFolder = currentFolder.substring(1);
    }

    try {
        // Lấy tài nguyên (file) trong thư mục hiện tại (sử dụng tiền tố)
        const fileResult = await cloudinary.api.resources({
            type: 'upload', 
            prefix: `${currentFolder}/`, // Chỉ lấy các file bắt đầu bằng tiền tố này
            max_results: 50,
            depth: 1, // Chỉ lấy file trong folder hiện tại, không lấy file trong subfolder
        });

        // Lấy danh sách các thư mục (folders) con
        const folderResult = await cloudinary.api.sub_folders(currentFolder);

        const fileList = fileResult.resources
            .filter(resource => resource.folder === currentFolder.replace(`${ROOT_FOLDER}/`, '')) // Chỉ lấy file trực tiếp trong folder
            .map(resource => ({
                name: resource.public_id, 
                basename: resource.filename, 
                size: resource.bytes,
                url: resource.secure_url, 
                uploadDate: resource.created_at.split('T')[0],
                isFolder: false, 
            }));

        const folderList = folderResult.folders.map(folder => ({
            name: `${currentFolder}/${folder.name}`, // Tên đầy đủ
            basename: folder.name, // Tên thư mục đơn giản
            size: 0,
            url: '',
            uploadDate: new Date().toISOString().split('T')[0],
            isFolder: true, 
        }));
        
        // Gộp danh sách folder và file, ưu tiên folder lên trước
        const combinedList = [...folderList, ...fileList];

        res.status(200).json({
            currentFolder: currentFolder,
            items: combinedList
        });
    } catch (err) {
        console.error('Lỗi Cloudinary List:', err);
        // Nếu Cloudinary trả về lỗi (ví dụ: folder không tồn tại), trả về folder rỗng
        if (err.http_code === 404) {
             return res.status(200).json({
                currentFolder: currentFolder,
                items: []
            });
        }
        res.status(500).json({ error: 'Lỗi server khi lấy danh sách file/folder.' });
    }
});

// === 2. POST: Tải file lên Cloudinary (Đã cập nhật để xử lý folder) ===
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

    try {
        const folderName = folderPath; // Path đã đầy đủ (ví dụ: flutter_file_manager/A/B)
        
        const result = await cloudinary.api.create_folder(folderName);
        
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
        // Cloudinary trả về lỗi 400 nếu folder đã tồn tại
        if (err.http_code === 400 && err.message.includes("already exists")) {
            return res.status(409).json({ error: 'Thư mục đã tồn tại.' });
        }
        console.error('Lỗi tạo thư mục:', err);
        return res.status(500).json({ error: 'Lỗi server khi tạo thư mục.' });
    }
});

// === 4. DELETE: Xóa Folder ===
app.delete('/delete-folder', async (req, res) => {
    const { folderPath } = req.body; 
    if (!folderPath) {
        return res.status(400).json({ error: 'Thiếu đường dẫn thư mục.' });
    }

    try {
        // Xóa folder và tất cả file/folder con bên trong (recursive)
        const result = await cloudinary.api.delete_folder(folderPath);

        if (result.message === 'Deleted') {
            return res.status(200).json({ message: `Đã xóa thư mục ${folderPath} thành công.` });
        } else {
            return res.status(404).json({ error: 'Không tìm thấy thư mục hoặc lỗi khi xóa.' });
        }
    } catch (err) {
        console.error('Lỗi xóa thư mục:', err);
        return res.status(500).json({ error: 'Lỗi server khi xóa thư mục.' });
    }
});

// === 5. DELETE: Xóa File (Đã cập nhật để dùng body) ===
app.delete('/delete', async (req, res) => {
    // API Cloudinary dùng public_id để xóa (đã sửa lỗi gửi tham số từ client)
    const publicId = req.body.publicId || req.query.id; 
    
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
