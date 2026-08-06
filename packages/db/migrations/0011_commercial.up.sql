CREATE TABLE entitlements (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX entitlements_user_id_idx ON entitlements (user_id);

CREATE TRIGGER entitlements_set_updated_at
BEFORE UPDATE ON entitlements
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  entitlement_id BIGINT REFERENCES entitlements (id) ON DELETE SET NULL,
  amount_kobo BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  provider TEXT NOT NULL
    CHECK (provider IN ('paystack', 'flutterwave', 'moniepoint', 'bank_transfer', 'voucher')),
  provider_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'successful', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transactions_user_id_idx ON transactions (user_id);

CREATE TRIGGER transactions_set_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vouchers (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  redeemed_by_user_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER vouchers_set_updated_at
BEFORE UPDATE ON vouchers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
