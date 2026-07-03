# Walkthrough: Payment QR Code Feature Implementation

I have completed the implementation of the QR payment interface and its corresponding backend failure logic.

## Changes Made

### 1. Backend Changes
- **Route Additions**: Added the PUT route `/api/orders/:id/fail-payment` in [orders.routes.js](file:///Users/judyhoang/offsite/backend/src/routes/orders.routes.js).
- **Controller Implementation**: Implemented the `failPayment` function in [orders.controller.js](file:///Users/judyhoang/offsite/backend/src/controllers/orders.controller.js). It performs standard authentication/ownership checks and transitions the order's `payment_status` to `'failed'` and ensures `order_status` remains `'pending'`.

### 2. Frontend Services & Routing Changes
- **Checkout Service**: Integrated the `failPayment` API wrapper method in [checkout.service.ts](file:///Users/judyhoang/offsite/frontend/src/app/features/purchase/services/checkout.service.ts).
- **Routing**: Added route mapping for `/checkout/payment-qr` in [app.routes.ts](file:///Users/judyhoang/offsite/frontend/src/app/app.routes.ts).
- **Redirection**: Modified the checkout submission handler in [checkout.component.ts](file:///Users/judyhoang/offsite/frontend/src/app/features/purchase/pages/checkout/checkout.component.ts) to intercept QR payments and route them to `/checkout/payment-qr` with the submitted order payload.

### 3. Payment QR Page Component
We implemented the standalone `PaymentQrComponent` page:
- **TypeScript Logic** ([payment-qr.component.ts](file:///Users/judyhoang/offsite/frontend/src/app/features/purchase/pages/payment-qr/payment-qr.component.ts)):
  - Manages the QR payment session in `localStorage` keyed by the order ID. This prevents countdown resets on page reload/refresh.
  - Implements the 15-minute countdown clock logic.
  - Formats data (`Transaction ID`, `Total Amount`, `DateTime`) and encodes it in a QR Code using `api.qrserver.com`.
  - Generates unique transaction IDs in the `TXN-YYY-XXXXX` format.
  - Handles the refresh actions:
    - Restricts timer reset during the active 15 minutes.
    - Allows up to 2 reloads (3 scans total) upon expiry.
    - On the 3rd expiration/reload attempt, it triggers the payment failure status and calls the backend to update the database.
- **HTML Template** ([payment-qr.component.html](file:///Users/judyhoang/offsite/frontend/src/app/features/purchase/pages/payment-qr/payment-qr.component.html)):
  - Renders a clean two-column grid matching the user's mockup.
  - Features the blurred QR code display and alerts when expired or failed.
  - Displays the order details in a read-only side summary card.
- **Styling** ([payment-qr.component.scss](file:///Users/judyhoang/offsite/frontend/src/app/features/purchase/pages/payment-qr/payment-qr.component.scss)):
  - Follows the project's beige-and-forest-green design system.
  - Supports responsive mobile styling.
  - Reuses summary card layouts and colors.

---

## Verification & Testing Instructions

You can run the workspace locally to verify these changes manually:

1. **Start the Development Servers**:
   Run `npm start` in the workspace root.
2. **Make a QR Purchase**:
   - Go to `http://localhost:4200/checkout`.
   - Fill in the delivery info.
   - Choose **QR Code** as the payment method.
   - Click **CONFIRM ORDER**.
3. **Verify state persistence**:
   - Verify that the timer counts down from 15 minutes.
   - Refresh the page and confirm the timer resumes from where it left off (doesn't reset).
4. **Test Expiration & Refresh limits**:
   - You can simulate expiration by editing the `expiresAt` field in `localStorage` under `payment_qr_{order_id}` to a past timestamp.
   - Once expired, verify that:
     - The QR code is blurred.
     - Clicking **REFRESH QR** generates a new QR code and restarts the 15-minute countdown.
   - Verify that after 2 refreshes (3 scans/timer periods total), clicking refresh is disabled, a failure banner is displayed, and the backend order status remains pending with payment status failed.
