// E:\du an\Flutter\file_manager_app\backend\server.js (Đã Sửa Lỗi Truy Vấn 2 Lần)

const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CẤU HÌNH CLOUDINARY ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'flutter_file_manager', 
        // QUAN TRỌNG: Phân biệt resource_type giữa 'image' và 'raw' (tài liệu/file)
        resource_type: (req, file) => {
            if (file.mimetype.startsWith('image/')) {
                return 'image';
            }
            return 'raw'; // Dùng 'raw' cho các file khác như .txt, .bat, .pdf
        },
        public_id: (req, file) => Date.now().toString() + '-' + file.originalname.split('.')[0]
    },
});

const upload = multer({ storage: storage });

app.use(cors());
app.use(express.text()); 

// === 1. GET: Lấy danh sách file (TRUY VẤN 2 LẦN ĐỂ LẤY TẤT CẢ CÁC LOẠI FILE) ===
app.get('/list', async (req, res) => {
    try {
        const prefix = 'flutter_file_manager/';

        // 1. Truy vấn loại 'raw' (tài liệu, .bat, .txt)
        const rawFilesPromise = cloudinary.api.resources({
            type: 'upload', 
            prefix: prefix,
            resource_type: 'raw',
            max_results: 50
        });

        // 2. Truy vấn loại 'image'
        const imageFilesPromise = cloudinary.api.resources({
            type: 'upload', 
            prefix: prefix,
            resource_type: 'image',
            max_results: 50
        });

        // Đợi cả hai truy vấn hoàn thành
        const [rawResult, imageResult] = await Promise.all([rawFilesPromise, imageFilesPromise]);
        
        const allResources = [...rawResult.resources, ...imageResult.resources];

        // Debug log cuối cùng
        console.log(`Cloudinary found ${allResources.length} files (Raw: ${rawResult.resources.length}, Image: ${imageResult.resources.length}).`);
        
        const fileList = allResources.map(resource => ({
            name: resource.public_id, 
            size: resource.bytes, 
            url: resource.secure_url, 
            uploadDate: resource.created_at.split('T')[0]
        }));

        res.status(200).json(fileList);
    } catch (err) {
        console.error('Lỗi Cloudinary List:', err);
        res.status(500).json({ error: 'Không thể lấy danh sách file từ Cloudinary. Lỗi API.' });
    }
});

// === 2. POST: Tải file lên Cloudinary ===
// ... (Hàm này giữ nguyên vì nó đã sử dụng storage có logic phân loại 'image'/'raw' mới)
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
// ... (Giữ nguyên)
app.delete('/delete/:fileName', async (req, res) => {
    // Logic delete cần biết resource_type, nhưng vì public_id đã lưu trong Flutter 
    // nên chúng ta sẽ dựa vào đó. Nếu file không phải ảnh, cần xóa 2 lần (raw, image). 
    // Đơn giản nhất là sử dụng hàm destroy để Cloudinary tự xác định.

    const publicId = req.params.fileName; 

    try {
        // Thử xóa như ảnh
        let result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });

        if (result.result !== 'ok') {
            // Thử xóa như raw (tài liệu) nếu xóa ảnh không thành công
            result = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
        }

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
    console.log(`Server Backend Cloudinary đang chạy tại cổng ${10000}`);
});
