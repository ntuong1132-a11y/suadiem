// history.js - Quản lý lịch sử phiên, lưu/đọc file JSON
const fs = require("fs");
const path = require("path");

const HISTORY_FILE = path.join(__dirname, "data", "history.json");
const MAX_HISTORY = 100;

function ensureDir() {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Đọc lịch sử từ file
function loadHistory() {
  ensureDir();
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("[history] Lỗi đọc file:", e.message);
  }
  return [];
}

// Lưu lịch sử ra file (atomic write)
function saveHistory(history) {
  ensureDir();
  const tmp = HISTORY_FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(history, null, 2), "utf8");
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (e) {
    console.error("[history] Lỗi ghi file:", e.message);
  }
}

// Thêm phiên mới vào lịch sử
// phien: { phien, ket_qua, du_doan, trang_thai, thoi_gian }
function addPhien(history, phien) {
  // Tránh trùng phiên
  if (history.find((p) => p.phien === phien.phien)) return history;
  const updated = [phien, ...history].slice(0, MAX_HISTORY);
  return updated;
}

// Lấy mảng số [0=Tài, 1=Xỉu] từ lịch sử để chạy predictor
// Chỉ lấy phiên đã có ket_qua thực (không phải dang_cho)
function getNumericHistory(history) {
  return history
    .filter((p) => p.ket_qua === "Tài" || p.ket_qua === "Xỉu")
    .map((p) => (p.ket_qua === "Tài" ? 0 : 1))
    .reverse(); // oldest -> newest
}

// Thống kê thắng thua từ lịch sử dự đoán
function calcThongKe(history) {
  const duDoan = history.filter(
    (p) => p.trang_thai === "thang" || p.trang_thai === "thua"
  );
  const thang = duDoan.filter((p) => p.trang_thai === "thang").length;
  const thua = duDoan.filter((p) => p.trang_thai === "thua").length;
  const tong = thang + thua;

  // Chuỗi hiện tại
  let chuoiThangHienTai = 0;
  let chuoiThuaHienTai = 0;
  for (const p of history) {
    if (p.trang_thai === "thang") {
      chuoiThangHienTai++;
      break;
    } else if (p.trang_thai === "thua") break;
  }
  for (const p of history) {
    if (p.trang_thai === "thua") {
      chuoiThuaHienTai++;
      break;
    } else if (p.trang_thai === "thang") break;
  }
  // Đếm đúng hơn: chuỗi liên tiếp từ đầu
  chuoiThangHienTai = 0;
  chuoiThuaHienTai = 0;
  for (const p of history) {
    if (p.trang_thai === "thang") chuoiThangHienTai++;
    else break;
  }
  for (const p of history) {
    if (p.trang_thai === "thua") chuoiThuaHienTai++;
    else break;
  }

  // Chuỗi dài nhất
  let chuoiThangDaiNhat = 0;
  let chuoiThuaDaiNhat = 0;
  let runT = 0, runX = 0;
  for (const p of [...duDoan].reverse()) {
    if (p.trang_thai === "thang") { runT++; runX = 0; }
    else { runX++; runT = 0; }
    chuoiThangDaiNhat = Math.max(chuoiThangDaiNhat, runT);
    chuoiThuaDaiNhat = Math.max(chuoiThuaDaiNhat, runX);
  }

  return {
    thang,
    thua,
    tong,
    ti_le_thang: tong ? ((thang / tong) * 100).toFixed(1) + "%" : "0.0%",
    chuoi_thang_hien_tai: chuoiThangHienTai,
    chuoi_thua_hien_tai: chuoiThuaHienTai,
    chuoi_thang_dai_nhat: chuoiThangDaiNhat,
    chuoi_thua_dai_nhat: chuoiThuaDaiNhat,
  };
}

module.exports = {
  loadHistory,
  saveHistory,
  addPhien,
  getNumericHistory,
  calcThongKe,
  MAX_HISTORY,
};
