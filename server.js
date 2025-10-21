// E:\du an\Flutter\file_manager_app\backend\server.js (ĐÃ SỬA LỖI XÓA FILE CUỐI CÙNG)

const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CẤU HÌNH CLOUDINARY ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer(); 
const CLOUDINARY_FOLDER = 'flutter_file_manager';

app.use(cors());
app.use(express.text()); 

// === 1. GET: Lấy danh sách file (Giữ nguyên) ===
app.get('/list', async (req, res) => {
    try {
        const prefix = CLOUDINARY_FOLDER + '/';
        
        const rawFilesPromise = cloudinary.api.resources({ type: 'upload', prefix: prefix, resource_type: 'raw', max_results: 50 });
        const imageFilesPromise = cloudinary.api.resources({ type: 'upload', prefix: prefix, resource_type: 'image', max_results: 50 });

        const [rawResult, imageResult] = await Promise.all([rawFilesPromise, imageFilesPromise]);
        const allResources = [...rawResult.resources, ...imageResult.resources];
        
        const fileList = allResources.map(resource => ({
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

// === 2. POST: Tải/Ghi đè file lên Cloudinary (Giữ nguyên) ===
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Không có file nào được tải lên.');
    }
    
    const file_name = req.file.originalname;
    const resource_type = req.file.mimetype.startsWith('image/') ? 'image' : 'raw';
    
    try {
        await cloudinary.uploader.upload_stream(
            { 
                folder: CLOUDINARY_FOLDER,
                public_id: file_name.split('.')[0], 
                resource_type: resource_type,
                overwrite: true, 
                invalidate: true 
            },
            (error, result) => {
                if (error) {
                    console.error('Upload Error:', error);
                    return res.status(500).send('Lỗi khi ghi đè file lên Cloudinary.');
                }
                res.status(201).json({ 
                    message: `Tải file ${file_name} lên thành công!`,
                    url: result.secure_url 
                });
            }
        ).end(req.file.buffer);

    } catch (e) {
        res.status(500).send('Lỗi máy chủ khi xử lý upload.');
    }
});

// === 3. DELETE: Xóa file khỏi Cloudinary (ĐÃ SỬA LỖI MÃ HÓA URL DỨT ĐIỂM) ===
app.delete('/delete/:fileName', async (req, res) => {
    // QUAN TRỌNG: SỬ DỤNG decodeURIComponent MỘT LẦN (Sửa lỗi mã hóa kép)
    const publicId = decodeURIComponent(req.params.fileName); 

    try {
        // Thử xóa 'image' trước, sau đó 'raw'
        let result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
        if (result.result !== 'ok') {
            result = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
        }
        
        if (result.result === 'ok') {
            res.status(200).json({ message: `Đã xóa file ${publicId}` });
        } else {
            // Log lỗi chi tiết để debug
            console.error('Cloudinary Delete Error:', result);
            res.status(500).json({ error: `Không tìm thấy file trên Cloudinary hoặc lỗi: ${result.result}` });
        }
    } catch (err) {
        console.error('Lỗi Xóa Server:', err);
        res.status(500).json({ error: 'Lỗi máy chủ khi thực hiện xóa.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server Backend Cloudinary đang chạy tại cổng ${PORT}`);
});
