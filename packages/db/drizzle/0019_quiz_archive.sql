-- Archivage (suppression douce) d'un quiz : masqué de la liste et non lançable, mais ses
-- questions et les rapports des parties passées restent intacts. Null = quiz actif.
-- Les policies RLS existantes sur "quiz" (isolation par tenant) couvrent déjà cette colonne.
ALTER TABLE "quiz" ADD COLUMN "archived_at" timestamp with time zone;
