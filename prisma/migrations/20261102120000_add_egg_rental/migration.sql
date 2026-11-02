-- CreateEnum
CREATE TYPE "egg_part" AS ENUM ('p12', 'p3');

-- CreateEnum
CREATE TYPE "egg_charger_type" AS ENUM ('usb_c', 'five_pin', 'unknown');

-- CreateTable
CREATE TABLE "egg_devices" (
    "id" UUID NOT NULL,
    "part" "egg_part" NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "wifi_name" TEXT NOT NULL DEFAULT '',
    "serial_number" TEXT NOT NULL DEFAULT '',
    "wifi_password" TEXT NOT NULL DEFAULT '',
    "model_code" TEXT,
    "charger_type" "egg_charger_type" NOT NULL DEFAULT 'unknown',
    "speed_mbps" INTEGER,
    "storage_location" TEXT NOT NULL,
    "monthly_data_gb" INTEGER,
    "contract_ends_on" DATE,
    "caution_note" TEXT,
    "data_exhausted" BOOLEAN NOT NULL DEFAULT false,
    "data_exhausted_at" TIMESTAMP(3),
    "data_exhausted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "egg_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "egg_rentals" (
    "id" UUID NOT NULL,
    "egg_device_id" UUID NOT NULL,
    "borrower_name" TEXT NOT NULL,
    "borrower_email" TEXT,
    "course_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "return_due_date" DATE NOT NULL,
    "actual_use_note" TEXT,
    "note" TEXT,
    "returned_at" TIMESTAMP(3),
    "returned_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "egg_rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "egg_guides" (
    "id" UUID NOT NULL,
    "part" "egg_part" NOT NULL,
    "content" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "egg_guides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "egg_devices_deleted_at_part_number_idx" ON "egg_devices"("deleted_at", "part", "number");

-- CreateIndex
CREATE UNIQUE INDEX "egg_devices_part_number_key" ON "egg_devices"("part", "number");

-- CreateIndex
CREATE INDEX "egg_rentals_egg_device_id_deleted_at_idx" ON "egg_rentals"("egg_device_id", "deleted_at");

-- CreateIndex
CREATE INDEX "egg_rentals_deleted_at_start_date_idx" ON "egg_rentals"("deleted_at", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "egg_guides_part_key" ON "egg_guides"("part");

-- AddForeignKey
ALTER TABLE "egg_rentals" ADD CONSTRAINT "egg_rentals_egg_device_id_fkey" FOREIGN KEY ("egg_device_id") REFERENCES "egg_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
