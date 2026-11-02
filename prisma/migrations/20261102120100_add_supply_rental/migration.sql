-- CreateTable
CREATE TABLE "supply_items" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "components" TEXT,
    "storage_location" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "supply_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_rentals" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "borrower_name" TEXT NOT NULL,
    "borrower_email" TEXT,
    "course_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "return_due_date" DATE NOT NULL,
    "note" TEXT,
    "returned_at" TIMESTAMP(3),
    "returned_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "supply_rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_rental_items" (
    "rental_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,

    CONSTRAINT "supply_rental_items_pkey" PRIMARY KEY ("rental_id","item_id")
);

-- CreateIndex
CREATE INDEX "supply_items_category_deleted_at_sort_order_idx" ON "supply_items"("category", "deleted_at", "sort_order");

-- CreateIndex
CREATE INDEX "supply_rentals_category_deleted_at_return_due_date_idx" ON "supply_rentals"("category", "deleted_at", "return_due_date");

-- CreateIndex
CREATE INDEX "supply_rental_items_item_id_idx" ON "supply_rental_items"("item_id");

-- AddForeignKey
ALTER TABLE "supply_rental_items" ADD CONSTRAINT "supply_rental_items_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "supply_rentals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_rental_items" ADD CONSTRAINT "supply_rental_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "supply_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
