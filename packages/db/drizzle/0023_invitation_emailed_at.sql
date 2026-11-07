-- Horodatage de l'envoi réussi de l'e-mail d'invitation (nul : jamais envoyé, ou renvoyé depuis).
ALTER TABLE "invitation" ADD COLUMN "emailed_at" timestamp with time zone;
