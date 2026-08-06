-- Kullanıcı watch bildirimlerini operasyon bildirimlerinden ayır.
ALTER TABLE notifications ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN watch_id INTEGER REFERENCES watches(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_watch ON notifications(watch_id, kind, created_at);
