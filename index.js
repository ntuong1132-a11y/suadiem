// index.js - Sunwin TX Prediction Server
// Poll http://180.93.102.202:3000/sunwintx mỗi 15 giây
// Dự đoán dựa trên 100 phiên lịch sử, lưu file data/history.json

const express = require("express");
const fetch = require("node-fetch");
const {
  loadHistory,
  saveHistory,
  addPhien,
  getNumericHistory,
  calcThongKe,
} = require("./history");
const { Ensemble, TAI } = require("./predictor");

const API_URL = "http://180.93.102.202:3000/sunwintx";
const POLL_INTERVAL = 15_000; // 15 giây
const PORT = 3001;

// ─── State ─────────────────────────────────────────────────────────────────
let history = loadHistory();        // mảng phiên lưu file
let ensemble = new Ensemble(20);    // model dự đoán
let lastPhienId = null;             // phiên mới nhất đã xử lý
let currentPrediction = null;       // dự đoán phiên hiện tại
let lastRaw = null;                 // raw response từ API
let pollError = null;               // lỗi poll gần nhất

// ─── Prediction Helper ──────────────────────────────────────────────────────
function runPrediction(numHist) {
  if (numHist.length < 4) return null;
  try {
    const { pred, p } = ensemble.predict(numHist);
    const label = pred === TAI ? "Tài" : "Xỉu";
    const confidence = Math.max(p[0], p[1]);
    return {
      du_doan: label,
      do_tin_cay: (confidence * 100).toFixed(1) + "%",
    };
  } catch {
    return null;
  }
}

// ─── Cập nhật trạng thái thắng/thua sau khi có kết quả ────────────────────
function resolveHistory(phienId, ketQua) {
  let updated = false;
  history = history.map((p) => {
    if (p.phien === phienId && p.trang_thai === "dang_cho") {
      const thangThua =
        p.du_doan === ketQua ? "thang" : "thua";
      updated = true;
      // Cập nhật ensemble với kết quả thực
      const actual = ketQua === "Tài" ? TAI : 1;
      ensemble.update(actual);
      return { ...p, ket_qua: ketQua, trang_thai: thangThua };
    }
    return p;
  });
  if (updated) saveHistory(history);
}

// ─── Poll API ───────────────────────────────────────────────────────────────
async function poll() {
  try {
    const res = await fetch(API_URL, { timeout: 10_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastRaw = data;
    pollError = null;

    // data.phien_truoc  = phiên vừa có kết quả
    // data.phien_nay    = phiên đang chờ
    // data.xuc_xac1/2/3 = kết quả xúc xắc phiên trước
    // data.ket_qua      = "Tài"/"Xỉu" của phiên trước

    const phienTruoc = data.phien_truoc;
    const phienNay   = data.phien_nay;
    const ketQuaTruoc = data.ket_qua; // kết quả thực phiên trước

    // 1. Giải quyết phiên trước nếu chưa xử lý
    if (phienTruoc && ketQuaTruoc) {
      resolveHistory(phienTruoc, ketQuaTruoc);

      // Nếu phiên trước chưa có trong history (lần đầu chạy), thêm vào
      if (!history.find((p) => p.phien === phienTruoc)) {
        const rec = {
          phien: phienTruoc,
          ket_qua: ketQuaTruoc,
          du_doan: null,
          trang_thai: "no_predict",
          thoi_gian: data.thoi_gian || "",
          xuc_xac: [data.xuc_xac1, data.xuc_xac2, data.xuc_xac3],
        };
        history = addPhien(history, rec);
        saveHistory(history);
      }
    }

    // 2. Dự đoán phiên hiện tại nếu chưa làm
    if (phienNay && phienNay !== lastPhienId) {
      lastPhienId = phienNay;

      const numHist = getNumericHistory(history);
      const pred = runPrediction(numHist);
      currentPrediction = pred;

      // Thêm phiên mới vào history với trạng thái dang_cho
      const newRec = {
        phien: phienNay,
        ket_qua: "dang_cho",
        du_doan: pred ? pred.du_doan : null,
        trang_thai: "dang_cho",
        thoi_gian: data.thoi_gian || "",
        xuc_xac: [],
      };
      history = addPhien(history, newRec);
      saveHistory(history);

      console.log(
        `[poll] Phiên ${phienNay} → Dự đoán: ${pred ? pred.du_doan : "N/A"} (${pred ? pred.do_tin_cay : "-"})`
      );
    }
  } catch (e) {
    pollError = e.message;
    console.error("[poll] Lỗi:", e.message);
  }
}

// ─── Express Server ─────────────────────────────────────────────────────────
const app = express();

// JSON response theo format ảnh
app.get("/sunwintx", (req, res) => {
  const thongKe = calcThongKe(history);

  // Lịch sử 5 phiên gần nhất để hiển thị
  const lichSu = history.slice(0, 5).map((p) => ({
    phien: p.phien,
    du_doan: p.du_doan,
    ket_qua: p.ket_qua,
    trang_thai: p.trang_thai,
  }));

  const raw = lastRaw || {};

  res.json({
    id: "VandaiSunwin",
    game: "Sunwin TX",
    phien_truoc: raw.phien_truoc || null,
    xuc_xac1: raw.xuc_xac1 || null,
    xuc_xac2: raw.xuc_xac2 || null,
    xuc_xac3: raw.xuc_xac3 || null,
    ket_qua: raw.ket_qua || null,
    thoi_gian: raw.thoi_gian || null,
    phien_nay: raw.phien_nay || null,
    du_doan: currentPrediction ? currentPrediction.du_doan : null,
    do_tin_cay: currentPrediction ? currentPrediction.do_tin_cay : "0%",
    thong_ke: thongKe,
    lich_su: lichSu,
    poll_error: pollError || null,
  });
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", phien_hien_tai: lastPhienId, poll_interval: "15s" });
});

// ─── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Đang chạy tại http://localhost:${PORT}/sunwintx`);
  console.log(`[server] Poll API ${API_URL} mỗi ${POLL_INTERVAL / 1000}s`);
});

// Poll ngay lần đầu, sau đó mỗi 15s
poll();
setInterval(poll, POLL_INTERVAL);
