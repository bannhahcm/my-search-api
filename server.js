// --- BƯỚC 1: NẠP CÁC THƯ VIỆN CẦN THIẾT ---
const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const cors = require('cors');

// Nạp các biến môi trường từ tệp .env (đặc biệt là DATABASE_URL)
dotenv.config();

// --- BƯỚC 2: KHỞI TẠO ỨNG DỤNG VÀ KẾT NỐI DATABASE ---
const app = express();
const port = 3000; // API của chúng ta sẽ chạy ở cổng 3000

// Cho phép các trang web khác có thể gọi tới API này (rất quan trọng cho demo)
app.use(cors());

// Kiểm tra xem chuỗi kết nối database đã có chưa
if (!process.env.DATABASE_URL) {
  console.error("Lỗi: Vui lòng cung cấp chuỗi kết nối DATABASE_URL trong tệp .env");
  process.exit(1);
}

// Tạo một "pool" kết nối tới PostgreSQL. Pool giúp quản lý kết nối hiệu quả.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// --- BƯỚC 3: TẠO ĐƯỜNG LINK API TÌM KIẾM ---
// Chúng ta sẽ tạo một đường link là /search
// Người dùng sẽ gọi: http://localhost:3000/search?q=từ_khóa_cần_tìm
app.get('/search', async (req, res) => {
  // Lấy từ khóa tìm kiếm 'q' từ URL
  const { q } = req.query;

  // Nếu người dùng không nhập gì, trả về một danh sách rỗng
  if (!q) {
    return res.json([]);
  }

  console.log(`Đang tìm kiếm với từ khóa: "${q}"`);

  try {
    // Đây chính là câu lệnh SQL Full-Text Search mà chúng ta đã chuẩn bị
    const searchQuery = `
      SELECT 
          searchable_type,
          title,
          description,
          url,
          image_url,
          ts_rank(fts_document, websearch_to_tsquery('vietnamese', $1)) AS score
      FROM 
          global_search_index
      WHERE
          fts_document @@ websearch_to_tsquery('vietnamese', $1)
      ORDER BY 
          score DESC
      LIMIT 20;
    `;

    // Thực thi câu lệnh SQL một cách an toàn
    // [q] là cách truyền tham số để tránh lỗi bảo mật SQL Injection
    const results = await pool.query(searchQuery, [q]);

    // Trả kết quả tìm được (dưới dạng JSON) về cho người gọi
    res.json(results.rows);

  } catch (error) {
    console.error('Lỗi khi thực hiện tìm kiếm:', error);
    res.status(500).json({ error: 'Đã có lỗi xảy ra ở phía server.' });
  }
});

// --- BƯỚC 4: KHỞI ĐỘNG SERVER ---
app.listen(port, () => {
  console.log(`API Server đang chạy tại http://localhost:${port}`);
  console.log(`Thử nghiệm tìm kiếm bằng cách truy cập: http://localhost:${port}/search?q=căn hộ`);
});
