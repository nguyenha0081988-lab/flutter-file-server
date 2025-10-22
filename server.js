// server.js (FIX LỖI CUỐI CÙNG: Hiển thị file sau khi upload)

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

// === 1. GET: Lấy danh sách file và folder (FIXED LỌC FILE) ===
app.get('/list', async (req, res) => {
    let currentFolder = req.query.folder || ROOT_FOLDER; 

    if (currentFolder.startsWith('/')) {
        currentFolder = currentFolder.substring(1);
    }
    
    // Tiền tố cho API resources
    const prefix = currentFolder === ROOT_FOLDER ? '' : `${currentFolder}/`; 

    try {
        const fileResult = await cloudinary.api.resources({
            type: 'upload', 
            prefix: prefix, 
            max_results: 500, 
            depth: 10, // Giữ depth cao để tìm kiếm
        });

        let folderResult = { folders: [] };
        try {
            folderResult = await cloudinary.api.sub_folders(currentFolder);
        } catch (e) {
            if (e.http_code !== 404) { console.error("Lỗi khi lấy sub_folders:", e); }
        }
        
        const combinedList = [];
        const currentFolderIsRoot = currentFolder === ROOT_FOLDER;

        // 1. Thêm các thư mục con (Giữ nguyên)
        for (const folder of folderResult.folders) {
            combinedList.push({
                name: `${currentFolder}/${folder.name}`,
                basename: folder.name, 
                size: 0,
                url: '',
                uploadDate: new Date().toISOString().split('T')[0],
                isFolder: true, 
            });
        }
        
        // 2. Thêm các file trực tiếp (SỬA LỖI LỌC)
        for (const resource of fileResult.resources) {
            const publicId = resource.public_id;
            let isDirectFile = false;

            if (currentFolderIsRoot) {
                 // Ở thư mục gốc (flutter_file_manager): Lọc những file KHÔNG nằm trong sub-folder
                 // Ví dụ: 'file.txt' hoặc 'flutter_file_manager/file.txt' (và không có dấu '/' sau đó)
                 
                 // Lấy phần còn lại của đường dẫn sau khi loại bỏ ROOT_FOLDER/
                 const relativePath = publicId.startsWith(ROOT_FOLDER) 
                     ? publicId.substring(ROOT_FOLDER.length + 1)
                     : publicId; 
                 
                 // File trực tiếp nếu không chứa dấu '/' nào HOẶC publicId không có tiền tố folder (file cũ)
                 isDirectFile = relativePath.indexOf('/') === -1;

            } else {
                 // Ở thư mục con (ví dụ: 'flutter_file_manager/02')
                 const relativePath = publicId.substring(currentFolder.length + 1);
                 isDirectFile = publicId.startsWith(`${currentFolder}/`) && relativePath.indexOf('/') === -1;
            }
            
            if (isDirectFile) {
                combinedList.push({
                    name: publicId, 
                    basename: resource.filename, 
                    size: resource.bytes,
                    url: resource.secure_url, 
                    uploadDate: resource.created_at.split('T')[0],
                    isFolder: false, 
                });
            }
        }

        res.status(200).json({
            currentFolder: currentFolder,
            items: combinedList
        });
    } catch (err) {
        console.error('Lỗi Cloudinary List DỪNG CHƯƠNG TRÌNH:', err);
        if (err.http_code === 404) {
             return res.status(200).json({
                currentFolder: currentFolder,
                items: []
            });
        }
        res.status(500).json({ error: 'Lỗi server khi lấy danh sách file/folder.' });
    }
});

// === 2. POST: Tải file lên Cloudinary (DÙNG MIDDLEWARE MULTER) ===
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
    
    const folderName = folderPath; 

    try {
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
        if (err.http_code === 400 && err.message.includes("already exists")) {
            return res.status(409).json({ error: 'Thư mục đã tồn tại.' });
        }
        console.error('Lỗi tạo thư mục:', err);
        return res.status(500).json({ error: 'Lỗi server khi tạo thư mục.' });
    }
});

// === 4. DELETE: Xóa Folder (FIXED: Xóa đệ quy và Lỗi 404) ===
app.delete('/delete-folder', async (req, res) => {
    const { folderPath } = req.body; 
    if (!folderPath) {
        return res.status(400).json({ error: 'Thiếu đường dẫn thư mục.' });
    }
    
    const pathPrefix = folderPath; 

    try {
        // 1. Xóa tất cả file bên trong folder đó (RECURSIVE)
        await cloudinary.api.delete_resources_by_prefix(`${pathPrefix}/`);

        // 2. Xóa folder đó
        const result = await cloudinary.api.delete_folder(pathPrefix);

        if (result.message === 'Deleted' || result.deleted_counts > 0) {
            return res.status(200).json({ message: `Đã xóa thư mục ${folderPath} và tất cả nội dung thành công.` });
        } else {
             return res.status(200).json({ message: `Thư mục ${folderPath} đã được xóa hoặc không còn tồn tại.` });
        }
    } catch (err) {
        console.error('Lỗi xóa thư mục:', err);
        if (err.http_code === 404) {
             return res.status(200).json({ message: `Thư mục ${folderPath} không tồn tại (Đã xóa thành công).` });
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
