# Luồng bản nháp Admin Products

- Products dùng dữ liệu trong collection Products. Mỗi sản phẩm có một dòng, không thêm nhãn có bản nháp.
- Drafts nằm cạnh Out of stock. Khi chọn, bảng dùng nội dung trong ProductDrafts, kèm thời gian lưu và trạng thái bán hiện tại của sản phẩm gốc.
- Search trên thanh đầu trang chỉ tìm trong mục đang xem: Products hoặc Drafts. Hai nguồn không được trộn thành hai dòng của cùng sản phẩm.
- Mở Edit từ cả hai mục đều nạp bản nháp đã lưu nếu có. Editor hiển thị thông báo đang sửa bản nháp; quay lại giữ mục và từ khoá tìm kiếm.
- Save draft chỉ lưu ProductDrafts, không cập nhật nội dung hay Active/Inactive của Products. Với sản phẩm mới, mã được giữ riêng bằng ProductIdSequences; chưa tạo bản ghi Products.
- Publish cập nhật Products rồi xoá bản nháp. Sản phẩm đã có giữ nguyên trạng thái Active/Inactive hiện tại. Sản phẩm mới được tạo Active khi Publish lần đầu.
- Trong Drafts có Edit draft, Publish draft và Discard draft. Discard dùng modal xác nhận và chỉ xoá ProductDrafts; không xoá hoặc sửa sản phẩm gốc.

## Kiểm chứng

- Frontend: 30 bài kiểm tra Products/service thành công, gồm tìm kiếm tách nguồn, mở bản nháp, thao tác publish và huỷ modal discard.
- Backend: 17 bài kiểm tra Products/visibility thành công, gồm bản nháp mới không tạo Products, lưu nháp không sửa nội dung/trạng thái bán, publish và discard độc lập với trạng thái bán.
- Lần triển khai này chỉ sửa code và chạy kiểm tra với dữ liệu giả; không chạy thao tác ghi/publish sản phẩm trong database thật.
