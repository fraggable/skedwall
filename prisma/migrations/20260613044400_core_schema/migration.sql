/*
  Warnings:

  - You are about to drop the `SetupCheck` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "WallpaperMode" AS ENUM ('LATEST_UPLOADED', 'SELECTED', 'RANDOM_DAILY');

-- CreateEnum
CREATE TYPE "GeneratedImageStatus" AS ENUM ('SUCCESS', 'FAILED');

-- DropTable
DROP TABLE "SetupCheck";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "email_verified" TIMESTAMP(3),
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "max_events" INTEGER NOT NULL DEFAULT 6,
    "wallpaper_mode" "WallpaperMode" NOT NULL DEFAULT 'LATEST_UPLOADED',
    "selected_wallpaper_id" TEXT,
    "generation_enabled" BOOLEAN NOT NULL DEFAULT true,
    "wallpaper_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallpapers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "original_filename" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallpapers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_images" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallpaper_id" TEXT,
    "storage_path" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "GeneratedImageStatus" NOT NULL DEFAULT 'SUCCESS',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_wallpaper_selections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallpaper_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_wallpaper_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_wallpaper_token_key" ON "user_settings"("wallpaper_token");

-- CreateIndex
CREATE INDEX "wallpapers_user_id_created_at_idx" ON "wallpapers"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "generated_images_user_id_date_idx" ON "generated_images"("user_id", "date");

-- CreateIndex
CREATE INDEX "generated_images_user_id_created_at_idx" ON "generated_images"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "daily_wallpaper_selections_wallpaper_id_idx" ON "daily_wallpaper_selections"("wallpaper_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_wallpaper_selections_user_id_date_key" ON "daily_wallpaper_selections"("user_id", "date");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_selected_wallpaper_id_fkey" FOREIGN KEY ("selected_wallpaper_id") REFERENCES "wallpapers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallpapers" ADD CONSTRAINT "wallpapers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_wallpaper_id_fkey" FOREIGN KEY ("wallpaper_id") REFERENCES "wallpapers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_wallpaper_selections" ADD CONSTRAINT "daily_wallpaper_selections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_wallpaper_selections" ADD CONSTRAINT "daily_wallpaper_selections_wallpaper_id_fkey" FOREIGN KEY ("wallpaper_id") REFERENCES "wallpapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
