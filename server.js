// server.js (FIX LOGIC CUỐI CÙNG: Đảm bảo hiển thị tất cả file)

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
            const currentFolder = req.body.folder || ROOT_FOLDER;
            
            const parts = file.originalname.split('.');
            const baseName = parts.slice(0, -1).join('.');

            return `${currentFolder}/${baseName}`;
        }
    },
    overwrite: true,
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } 
});

app.use(cors());
app.use(bodyParser.json()); 
app.use(express.text()); 

// === 1. GET: Lấy danh sách file và folder ===
app.get('/list', async (req, res) => {
    let currentFolder = req.query.folder || ROOT_FOLDER; 

    if (currentFolder.startsWith('/')) {
        currentFolder = currentFolder.substring(1);
    }
    
    // Nếu là ROOT_FOLDER, prefix rỗng để lấy tất cả tài nguyên ở gốc và thư mục con cấp 1
    const prefix = currentFolder === ROOT_FOLDER ? '' : `${currentFolder}/`; 

    try {
        const fileResult = await cloudinary.api.resources({
            type: 'upload', 
            prefix: prefix, 
            max_results: 500, 
            depth: currentFolder === ROOT_FOLDER ? 1 : 2, // Tăng depth cho thư mục con
        });

        let folderResult = { folders: [] };
        try {
            folderResult = await cloudinary.api.sub_folders(currentFolder);
        } catch (e) {
            if (e.http_code !== 404) { console.error("Lỗi khi lấy sub_folders:", e); }
        }
        
        const combinedList = [];
        const currentFolderLength = currentFolder.length;

        // 1. Thêm các thư mục con
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
        
        // 2. Thêm các file trực tiếp (FIX LỌC FILE CUỐI CÙNG)
        for (const resource of fileResult.resources) {
            const publicId = resource.public_id;
            let isDirectFile = false;

            if (currentFolder === ROOT_FOLDER) {
                 // Ở thư mục gốc, file trực tiếp là file KHÔNG nằm trong sub-folder
                 const parts = publicId.split('/');
                 // File trực tiếp nếu chỉ có 1 phần tử (file cũ) hoặc 2 phần tử (file mới)
                 if (parts.length <= 1 || (parts.length === 2 && parts[0] === ROOT_FOLDER)) {
                     isDirectFile = true;
                 }
            } else {
                 // Ở thư mục con, file trực tiếp nếu không có dấu '/' nào sau tên folder hiện tại
                 const relativePath = publicId.substring(currentFolderLength + 1);
                 if (publicId.startsWith(`${currentFolder}/`) && relativePath.indexOf('/') === -1) {
                     isDirectFile = true;
                 }
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
app.post('/upload', (req, res, next) => {
    upload.single('file')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
             console.error('Multer Error:', err);
             return res.status(500).json({ error: `Lỗi Multer: ${err.message}` });
        } else if (err) {
            console.error('Lỗi Upload BẤT NGỜ:', err);
            return res.status(500).json({ error: `Lỗi Server Nội bộ: ${err.message || JSON.stringify(err)}` });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'Không có file nào được tải lên.' });
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
