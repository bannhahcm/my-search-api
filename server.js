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
// --- BƯỚC 3.6: TẠO ĐƯỜNG LINK API CUNG CẤP DỮ LIỆU CHO MENU ---
app.get('/api/menu-data', async (req, res) => {
  console.log("Đang lấy dữ liệu cho menu...");
  try {
    // Thực thi nhiều truy vấn cùng lúc để tăng hiệu năng
    const [projectTypes, locations, featuredProjects, featuredNews] = await Promise.all([
      // Lấy danh sách Loại hình dự án
      pool.query(`SELECT name, slug FROM "ProjectType" ORDER BY name ASC`),
      // Lấy danh sách Địa điểm (chỉ Tỉnh/Thành phố)
      pool.query(`SELECT name, slug FROM "Location" WHERE type = 'CITY' ORDER BY name ASC`),
      // Lấy 2 dự án nổi bật (ví dụ)
      pool.query(`SELECT name, slug, cached_project_type_slug, cached_location_slug FROM "Project" LIMIT 2`),
      // Lấy 2 tin tức nổi bật
      pool.query(`SELECT title, slug, cached_category_slug FROM "NewsArticle" WHERE is_featured = true LIMIT 2`)
    ]);

    // Trả về một đối tượng JSON chứa tất cả dữ liệu
    res.json({
      projectTypes: projectTypes.rows,
      locations: locations.rows,
      featured: {
        projects: featuredProjects.rows,
        news: featuredNews.rows,
      }
    });

  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu menu:', error);
    res.status(500).json({ error: 'Đã có lỗi xảy ra ở phía server.' });
  }
});
// --- BƯỚC 4: KHỞI ĐỘNG SERVER ---
app.listen(port, () => {
  console.log(`API Server đang chạy tại http://localhost:${port}`);
  console.log(`Thử nghiệm tìm kiếm bằng cách truy cập: http://localhost:${port}/search?q=căn hộ`);
});
