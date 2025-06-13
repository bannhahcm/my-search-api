// --- BƯỚC 1: NẠP CÁC THƯ VIỆN CẦN THIẾT ---
import express from 'express';
import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
import cors from 'cors';

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
   ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// --- BƯỚC 3: TẠO ĐƯỜNG LINK API TÌM KIẾM ---
// API 1: TÌM KIẾM TOÀN TRANG (giữ nguyên)
app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  console.log(`Đang tìm kiếm với từ khóa: "${q}"`);
  try {
    // --- PHẦN MỚI: GHI NHẬN LƯỢT TÌM KIẾM ---
    // Chạy bất đồng bộ để không làm chậm kết quả trả về cho người dùng
    const searchTerm = q.toLowerCase().trim();
    if (searchTerm) {
      pool.query(`
        INSERT INTO "SearchAnalytics" (term, last_searched_at) VALUES ($1, NOW())
        ON CONFLICT (term) DO UPDATE 
        SET search_count = "SearchAnalytics".search_count + 1,
            last_searched_at = NOW();
      `, [searchTerm]).catch(err => console.error('Lỗi ghi nhận lượt tìm kiếm:', err));
    }
    const searchQuery = `
    SELECT
      searchable_id,
      searchable_type,
      listing_type,
      title,
      description,
      url,
      image_url,
      published_date,
      price_from,
      price_to,
      price_unit,
      address_detail,
      sub_type_slug,
      ts_rank(fts_document, websearch_to_tsquery('public.vietnamese', $1)) AS score
  FROM 
      public.global_search_index
  WHERE
      fts_document @@ websearch_to_tsquery('public.vietnamese', $1)
  ORDER BY 
      score DESC
  LIMIT 20;
    `;
    const results = await pool.query(searchQuery, [q]);
    res.json(results.rows);
  } catch (error) {
    console.error('Lỗi khi thực hiện tìm kiếm:', error);
    res.status(500).json({ error: 'Đã có lỗi xảy ra ở phía server.' });
  }
});

// API 2: LẤY DỮ LIỆU KHỞI TẠO MENU (chạy 1 lần khi tải trang)
app.get('/api/menu/initial-data', async (req, res) => {
  console.log("Đang lấy dữ liệu khởi tạo cho menu...");
  try {
    const [projectTypes, productTypes, wikiTopics, newsCategories, businessTypes] = await Promise.all([
      pool.query(`SELECT name, slug FROM "ProjectType" ORDER BY name ASC`),
      pool.query(`SELECT name, slug FROM "ProductType" ORDER BY name ASC`),
      pool.query(`SELECT name, 'wiki/' || slug AS slug FROM "WikiTopic" ORDER BY name ASC`),
      pool.query(`SELECT name, 'tin-tuc/' || slug AS slug FROM "NewsCategory" ORDER BY name ASC`),
      pool.query(`SELECT name, slug FROM "BusinessType" ORDER BY name ASC`),
    ]);

    res.json({
      duAn: { types: projectTypes.rows },
      muaBan: { types: productTypes.rows },
      choThue: { types: productTypes.rows },
      wiki: { topics: wikiTopics.rows },
      tinTuc: { categories: newsCategories.rows },
      doanhNghiep: { types: businessTypes.rows }
    });
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu khởi tạo menu:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API 3: LẤY DỮ LIỆU ĐỘNG CHO CÁC CỘT TRONG MEGA MENU KHI HOVER
app.get('/api/menu/dynamic-data', async (req, res) => {
  const { type, slug } = req.query;

  if (!type || !slug) {
    return res.status(400).json({ error: 'Thiếu tham số type hoặc slug' });
  }
  
  console.log(`Lấy dữ liệu động cho: ${type} - ${slug}`);

  try {
    let locationsQuery, featuredQuery;
    let queryParams = [slug];

    // Giả định rằng bảng "Location" có cột parent_id để liên kết Quận/Huyện với Tỉnh/Thành phố
    const locationJoinLogic = `
        JOIN "Location" "District" ON P.location_id = "District".id
        JOIN "Location" "Province" ON "District".parent_id = "Province".id
    `;

    if (type === 'project') {
      locationsQuery = `
        SELECT DISTINCT "Province".name, "Province".slug 
        FROM "Project" P
        JOIN "ProjectType" PT ON P.project_type_id = PT.id
        ${locationJoinLogic}
        WHERE PT.slug = $1 AND "Province".type = 'CITY'
        ORDER BY "Province".name ASC LIMIT 5`;
      
      featuredQuery = `
        SELECT P.name, P.slug, (P.images)[1] as image_url, P.description,
               COALESCE(PL.name, '') as cached_location_slug, -- Lấy slug địa điểm
               COALESCE(PT.slug, '') as cached_project_type_slug -- Lấy slug loại dự án
        FROM "Project" P
        JOIN "ProjectType" PT ON P.project_type_id = PT.id
        LEFT JOIN "Location" PL ON P.location_id = PL.id
        WHERE PT.slug = $1 
        ORDER BY P.published_date DESC 
        LIMIT 1`;
    } 
    else if (type === 'sale' || type === 'rent') {
      const productTable = type === 'sale' ? '"ProductSale"' : '"ProductRent"';
      
      locationsQuery = `
        SELECT DISTINCT "Province".name, "Province".slug 
        FROM ${productTable} P
        JOIN "ProductType" PT ON P.product_type_id = PT.id
        ${locationJoinLogic}
        WHERE PT.slug = $1 AND "Province".type = 'CITY'
        ORDER BY "Province".name ASC LIMIT 5`;
      
      // Câu truy vấn này vẫn lấy dự án nổi bật liên quan, có thể giữ nguyên hoặc điều chỉnh nếu cần
      featuredQuery = `
        SELECT DISTINCT ON (pr.id) pr.name, pr.slug, (pr.images)[1] as image_url, pr.description
        FROM "Project" pr
        JOIN ${productTable} p ON p.project_id = pr.id
        JOIN "ProductType" pt ON p.product_type_id = pt.id
        WHERE pt.slug = $1
        ORDER BY pr.id DESC, pr.published_date DESC LIMIT 1`;
    } else {
        return res.status(400).json({ error: 'Loại menu không hợp lệ' });
    }

    const [locationsResult, featuredResult] = await Promise.all([
        pool.query(locationsQuery, queryParams),
        pool.query(featuredQuery, queryParams)
    ]);

    res.json({
        locations: locationsResult.rows,
        featured: {
            project: featuredResult.rows[0] || null
        }
    });

  } catch (error) {
    console.error(`Lỗi khi lấy dữ liệu động cho ${type} - ${slug}:`, error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});
app.get('/api/popular-searches', async (req, res) => {
  // Danh sách thủ công luôn hiển thị ở top
  const manualSearches = ['Aqua City', 'Vinhomes Grand Park'];

  try {
    // Lấy 3 từ khóa được tìm kiếm nhiều nhất từ database
    const result = await pool.query(`
      SELECT term FROM "SearchAnalytics" ORDER BY search_count DESC, last_searched_at DESC LIMIT 3;
    `);
    
    const organicSearches = result.rows.map(r => r.term);
    
    // Kết hợp 2 danh sách, loại bỏ trùng lặp và lấy 5 mục đầu tiên
    const combined = [...manualSearches, ...organicSearches];
    const popularSearches = [...new Set(combined)].slice(0, 5);

    res.json(popularSearches);
  } catch (error) {
    console.error('Lỗi khi lấy tìm kiếm phổ biến:', error);
    // Nếu có lỗi, chỉ trả về danh sách thủ công
    res.json(manualSearches);
  }
});
// --- BƯỚC 4: KHỞI ĐỘNG SERVER ---
app.listen(port, () => {
  console.log(`API Server đang chạy tại http://localhost:${port}`);
});