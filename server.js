// E:\du an\Flutter\file_manager_app\backend\server.js

const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CẤU HÌNH CLOUDINARY (SỬ DỤNG BIẾN MÔI TRƯỜNG) ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'flutter_file_manager', 
        resource_type: 'auto', 
        public_id: (req, file) => Date.now().toString() + '-' + file.originalname.split('.')[0]
    },
});

const upload = multer({ storage: storage });

app.use(cors());
app.use(express.text()); 

// === 1. GET: Lấy danh sách file (ĐÃ SỬA LỖI TRUY VẤN) ===
app.get('/list', async (req, res) => {
    try {
        // THAY ĐỔI: Sử dụng resource_type: 'all' để lấy tất cả các loại file
        const result = await cloudinary.api.resources({
            type: 'upload', 
            prefix: 'flutter_file_manager/',
            resource_type: 'all', 
            max_results: 100
        });

        const fileList = result.resources.map(resource => ({
            name: resource.public_id, 
            size: resource.bytes, 
            url: resource.secure_url, 
            uploadDate: resource.created_at.split('T')[0]
        }));

        res.status(200).json(fileList);
    } catch (err) {
        console.error('Lỗi Cloudinary List:', err);
        res.status(500).json({ error: 'Không thể lấy danh sách file từ Cloudinary.' });
    }
});

// === 2. POST: Tải file lên Cloudinary ===
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('Không có file nào được tải lên.');
    }
    
    res.status(201).json({ 
        message: `Tải file ${req.file.filename} lên Cloudinary thành công!`,
        file: {
            name: req.file.filename,
            size: req.file.size,
            url: req.file.path,
            uploadDate: new Date().toISOString().split('T')[0]
        }
    });
});

// === 3. DELETE: Xóa file khỏi Cloudinary ===
app.delete('/delete/:fileName', async (req, res) => {
    const publicId = req.params.fileName; 

    try {
        const result = await cloudinary.uploader.destroy(publicId);

        if (result.result === 'ok') {
            res.status(200).json({ message: `Đã xóa file ${publicId}` });
        } else {
            res.status(500).json({ error: `Lỗi xóa file: ${result.result}` });
        }
    } catch (err) {
        res.status(500).json({ error: 'Không thể xóa file.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server Backend Cloudinary đang chạy tại cổng ${PORT}`);
});
