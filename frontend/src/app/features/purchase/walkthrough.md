# Walkthrough: Payment QR Code & Mobile Scan Simulation Feature

I have implemented and updated the full QR payment flow, including a mobile scan simulation interface matching your design, backend routes, status polling, and redirection.

## Changes Made

### 1. Backend Changes
- **Status Retrieval API**: Added `GET /api/orders/:id/status` in [orders.routes.js](file:///Users/judyhoang/offsite/backend/src/routes/orders.routes.js) and implemented in [orders.controller.js](file:///Users/judyhoang/offsite/backend/src/controllers/orders.controller.js). This allows guest or authenticated users to fetch the checkout payment status securely.
- **Payment Confirmation API**: Added `PUT /api/orders/:id/confirm-payment` to transition order payment to `paid` and status to `processing`.
- **Payment Failure API**: Connected the mobile checkout cancel button to `PUT /api/orders/:id/fail-payment` to securely transition order payment status to `failed` and status to `pending`.

### 2. Frontend Services & Routing
- **Checkout Service**: Integrated the wrapper methods `confirmPayment` and `getOrderStatus` in [checkout.service.ts](file:///Users/judyhoang/offsite/frontend/src/app/features/purchase/services/checkout.service.ts).
- **Scan Simulation Routing**: Added route `/checkout/payment-qr/scan` to [app.routes.ts](file:///Users/judyhoang/offsite/frontend/src/app/app.routes.ts) pointing to the new `PaymentQrScanComponent`.

### 3. Payment QR Page (Desktop)
- **URL Encoding in QR Code**: The generated QR code now contains a URL pointing directly to the mobile scan simulation page: `${origin}/checkout/payment-qr/scan?order_id=...&transaction_id=...&amount=...`
- **Simulation Link**: Added a **"Simulate Mobile Scan ↗"** helper link below the QR code on the desktop view. This allows users to open the mobile scanning layout in a new tab for manual testing.
- **Status Polling**:
  - Implemented real-time status polling (every 3 seconds) using `getOrderStatus` in [payment-qr.component.ts](file:///Users/judyhoang/offsite/frontend/src/app/features/purchase/pages/payment-qr/payment-qr.component.ts).
  - If the user confirms payment on their phone, the desktop page automatically detects the status change, stops polling, clears the checkout local cache, and redirects them to the `/checkout/confirmed` success screen.
  - If the user cancels the payment on their phone, the desktop page detects it, updates to the failed/blurred payment state, and stops polling.

### 4. Mobile QR Scan Simulation Page (Mobile Layout)
Created the standalone `PaymentQrScanComponent` simulating a mobile phone screen:
- **Design Aesthetic**: Built a premium mobile-responsive layout matching the screenshot:
  - Sleek dark gradient header with slanted diagonal bottom clip-path.
  - Large white typography for payment amount.
  - Green security badge: `SECURE TRANSACTION` with a check icon.
  - Details card containing Provider (`Offsite`), Transaction ID, and Date & Time.
  - Encryption footnote with lock icon.
  - Interactive Action Buttons:
    - **CONFIRM PAYMENT** (forest green, pill-shaped, arrow icon).
    - **CANCEL PAYMENT** (off-white, red border and text).
- **Core Logic**:
  - **Confirm Payment (Active Timer)**: Sets status to `'paid'` and redirects the user to the `/checkout/confirmed` screen.
  - **Confirm Payment (Expired QR)**: If the current time exceeds the expiration timestamp (`expires_at`), disables confirmation, displays a red expiry warning banner: *"QR Code Expired. Please refresh checkout and scan again."*, and alerts the user.
  - **Cancel Payment**: Calls the backend to set the order payment status to `'failed'` (with order status remaining `'pending'`), then redirects to the `/checkout/canceled` screen.

---

## Verification & Testing Instructions

You can run the workspace locally to verify these changes manually:

1. **Start the Development Servers**:
   Run `npm start` in the workspace root.
2. **Make a QR Purchase**:
   - Go to `http://localhost:4200/checkout`.
   - Fill in the delivery info, choose **QR Code**, and click **CONFIRM ORDER**.
3. **Open Mobile Simulation**:
   - On the desktop QR page, look below the QR code and click the **Simulate Mobile Scan ↗** link. It will open the mobile simulation screen in a new tab.
4. **Test Successful Payment**:
   - On the simulation page, click **CONFIRM PAYMENT** (make sure it's within the 15-minute window).
   - Verify the simulation page redirects you to `/checkout/confirmed`.
   - Go back to the desktop tab and verify that it has automatically detected the payment and redirected you to `/checkout/confirmed` as well.
5. **Test Cancel Payment**:
   - Go through checkout again to generate a new QR code.
   - Click **Simulate Mobile Scan ↗** to open the simulation tab.
   - Click **CANCEL PAYMENT** on the simulation tab.
   - Verify it redirects you to the cancel page.
   - Return to the desktop tab; verify that the desktop page has automatically stopped the timer, blurred the QR code, and shows the **PAYMENT FAILED** status.
6. **Test Expired Payment**:
   - Generate a new QR code.
   - Copy the simulation URL, and modify the `expires_at` query parameter in the URL bar to a past timestamp (e.g. `expires_at=0`), then reload the simulation page.
   - Verify that the simulation page displays the red banner: *"QR Code Expired. Please refresh checkout and scan again."* and that the **CONFIRM PAYMENT** button is disabled.
