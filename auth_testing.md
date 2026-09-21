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