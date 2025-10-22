// server.js (ĐÃ SỬA LỖI CUỐI CÙNG: Hiển thị file cũ và Lỗi Xóa 404)

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

// === 1. GET: Lấy danh sách file và folder ===
app.get('/list', async (req, res) => {
    let currentFolder = req.query.folder || ROOT_FOLDER; 

    if (currentFolder.startsWith('/')) {
        currentFolder = currentFolder.substring(1);
    }
    
    const prefix = currentFolder === ROOT_FOLDER ? '' : `${currentFolder}/`;

    try {
        // LẤY TẤT CẢ FILE: Lấy tất cả tài nguyên có tiền tố
        const fileResult = await cloudinary.api.resources({
            type: 'upload', 
            prefix: currentFolder === ROOT_FOLDER ? '' : prefix, // Nếu ở gốc, lấy tất cả (prefix rỗng)
            max_results: 500, // Tăng giới hạn lên 500 để chắc chắn lấy đủ file cũ
            depth: 10, // Đặt depth cao để lấy tất cả file trong folder
        });

        // Lấy danh sách các thư mục (folders) con
        let folderResult = { folders: [] };
        try {
            folderResult = await cloudinary.api.sub_folders(currentFolder);
        } catch (e) {
            if (e.http_code !== 404) { console.error("Lỗi khi lấy sub_folders:", e); }
        }
        
        // --- LOGIC LỌC FILE CHÍNH XÁC ---
        const combinedList = [];
        const foundPaths = new Set();
        const currentFolderLength = currentFolder.length;

        // 1. Thêm các thư mục con
        for (const folder of folderResult.folders) {
            const fullPath = `${currentFolder}/${folder.name}`;
             if (!foundPaths.has(fullPath)) {
                combinedList.push({
                    name: fullPath,
                    basename: folder.name, 
                    size: 0,
                    url: '',
                    uploadDate: new Date().toISOString().split('T')[0],
                    isFolder: true, 
                });
                foundPaths.add(fullPath);
            }
        }
        
        // 2. Thêm các file trực tiếp
        for (const resource of fileResult.resources) {
            const publicId = resource.public_id;
            
            // Lọc file: Chỉ lấy file trực tiếp trong folder hiện tại
            const relativePath = publicId.substring(currentFolderLength); // Bỏ prefix
            
            if (currentFolder === ROOT_FOLDER) {
                 // Ở thư mục gốc, chỉ lấy những file KHÔNG nằm trong sub-folder
                 if (!publicId.includes('/') || publicId.startsWith(ROOT_FOLDER) && publicId.substring(ROOT_FOLDER.length + 1).indexOf('/') === -1) {
                    if (!foundPaths.has(publicId)) {
                        combinedList.push({
                            name: publicId, 
                            basename: resource.filename, 
                            size: resource.bytes,
                            url: resource.secure_url, 
                            uploadDate: resource.created_at.split('T')[0],
                            isFolder: false, 
                        });
                        foundPaths.add(publicId);
                    }
                 }
            } else {
                 // Ở thư mục con, chỉ lấy file trực tiếp
                 if (relativePath.startsWith('/') && relativePath.substring(1).indexOf('/') === -1) {
                     if (!foundPaths.has(publicId)) {
                        combinedList.push({
                            name: publicId, 
                            basename: resource.filename, 
                            size: resource.bytes,
                            url: resource.secure_url, 
                            uploadDate: resource.created_at.split('T')[0],
                            isFolder: false, 
                        });
                        foundPaths.add(publicId);
                    }
                 }
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

// === 2. POST: Tải file lên Cloudinary ===
// ... (Giữ nguyên)

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
// ... (Giữ nguyên)


app.listen(PORT, () => {
    console.log(`Server Backend Cloudinary đang chạy tại cổng ${PORT}`);
});
