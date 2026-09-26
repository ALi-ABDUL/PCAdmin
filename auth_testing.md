# Customer Portal Authentication & Cart-Merge Testing

## Existing authentication checks

1. Confirm `JWT_SECRET` is present in `backend/.env` and customer passwords remain bcrypt hashes.
2. Verify `POST /api/portal/login` rejects invalid credentials and unverified accounts.
3. Verify a successful sign-in returns a JWT and `GET /api/portal/me` accepts it as a Bearer token.

## Guest-cart merge checks

1. Create a guest cart with `PATCH /api/cart` and a unique `session_id`.
2. Create an account-cart line under a valid Bearer token.
3. Call `POST /api/portal/login` with `{ email, password, session_id }`.
4. Confirm the returned `cart` combines matching product/variant/price lines, retains distinct variants, and recalculates `line_total` and `subtotal`.
5. Confirm `GET /api/cart?session_id=<id>` is empty after the sign-in.
6. Repeat the same login with that session ID and confirm totals do not increase.

## Admin test-email session checks

1. Sign in through `POST /api/admin-accounts/login` and verify an `admin_access_token` httpOnly cookie is issued.
2. Verify `POST /api/email-templates/verification/send-test` is rejected without that cookie.
3. With an admin session, verify the endpoint selects the recipient from the admin account, accepts no recipient/body/HTML input, and returns only a safe delivery status.
4. Verify a second send within 60 seconds returns 429, and a manager session returns 403.