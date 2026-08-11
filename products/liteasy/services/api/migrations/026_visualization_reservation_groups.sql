-- Multi-stage raster generation reserves structured and image provider work
-- independently while consuming one user concurrency slot.

ALTER TABLE visualization_quota_reservations
  ADD COLUMN reservation_group_id text;

UPDATE visualization_quota_reservations
   SET reservation_group_id = reservation_id
 WHERE reservation_group_id IS NULL;

ALTER TABLE visualization_quota_reservations
  ALTER COLUMN reservation_group_id SET NOT NULL,
  ADD CONSTRAINT visualization_reservation_group_id_format
    CHECK (reservation_group_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ADD CONSTRAINT visualization_reservation_group_fk
    FOREIGN KEY (reservation_group_id)
    REFERENCES visualization_quota_reservations(reservation_id);

CREATE INDEX visualization_reservation_active_group_idx
  ON visualization_quota_reservations(subject_id, reservation_group_id, expires_at)
  WHERE state = 'reserved';
