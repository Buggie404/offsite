# Hướng Dẫn Cài Đặt và Chạy Dự Án Local

Tài liệu này hướng dẫn chi tiết các bước để cài đặt, cấu hình và chạy dự án **Offsite** trên môi trường local (máy tính cá nhân), đồng thời cung cấp thông tin các tài khoản thử nghiệm (Admin & User/Customer) để bạn có thể test đầy đủ các chức năng.

---

## 📋 Yêu Cầu Hệ Thống

Trước khi bắt đầu, hãy đảm bảo máy tính của bạn đã cài đặt các công cụ sau:
- **Node.js**: Phiên bản `v16.x` trở lên (Khuyến nghị bản LTS)
- **npm**: Phiên bản `v8.x` trở lên
- **MongoDB**: Một cơ sở dữ liệu MongoDB đang hoạt động (có thể dùng **MongoDB Atlas** đám mây miễn phí hoặc **MongoDB Community Server** chạy cục bộ ở cổng mặc định `mongodb://localhost:27017/offsite`).

---

## 🚀 Các Bước Cài Đặt và Khởi Chạy

### Bước 1: Cài đặt Dependencies cho toàn bộ dự án
Mở terminal tại thư mục gốc của dự án (`offsite/`) và chạy lệnh sau để tự động cài đặt các thư viện cho cả thư mục gốc, thư mục `backend`, và thư mục `frontend`:

```bash
npm run install-all
```

### Bước 2: Khởi Chạy Dự Án
Tại thư mục gốc (`offsite/`), khởi động đồng thời cả Backend API và Frontend Angular bằng lệnh duy nhất:

```bash
npm start
```

* **Frontend** sẽ chạy tại: [http://localhost:4200](http://localhost:4200)
* **Backend API** sẽ chạy tại: [http://localhost:5001](http://localhost:5001)

---

## 🔑 Tài Khoản Thử Nghiệm (Test Accounts)

Bạn có thể dùng các tài khoản sau để đăng nhập và trải nghiệm hệ thống:

### 1. Tài Khoản Quản Trị Viên (Admin)
* **Email:** `admin@offsite.vn`
* **Mật khẩu:** `P@ssword123`
* **Vai trò:** Quản lý đơn hàng, cập nhật trạng thái vận chuyển, theo dõi khiếu nại hoàn tiền tại trang Admin (`/admin`).

### 2. Tài Khoản Khách Hàng (User / Customer)
Hệ thống hỗ trợ 3 tài khoản khách hàng mẫu đã được cấu hình sẵn địa chỉ nhận hàng và phương thức thanh toán demo để test nhanh luồng mua hàng (Checkout):

* **Khách hàng 1:**
  * **Email:** `customer1@offsite.vn`
  * **Mật khẩu:** `P@ssword123`
  * **Tên hiển thị:** Nguyễn Văn A
* **Khách hàng 2:**
  * **Email:** `customer2@offsite.vn`
  * **Mật khẩu:** `P@ssword123`
  * **Tên hiển thị:** Trần Thị B
* **Khách hàng 3:**
  * **Email:** `customer3@offsite.vn`
  * **Mật khẩu:** `P@ssword123`
  * **Tên hiển thị:** Lê Văn C
