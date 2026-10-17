-- Device-reported tracking capability (reviewed, additive: one enum, three nullable columns; no
-- existing row or constraint changes, NULL = the device has not reported yet).
-- Rollback: ALTER TABLE "salespersons" DROP COLUMN "trackingDetail", DROP COLUMN "trackingState",
-- DROP COLUMN "trackingStateAt"; DROP TYPE "TrackingDeviceState";

-- CreateEnum
CREATE TYPE "TrackingDeviceState" AS ENUM ('TRACKING', 'PERMISSION_DENIED', 'BACKGROUND_DENIED', 'GPS_DISABLED', 'STOPPED');

-- AlterTable
ALTER TABLE "salespersons" ADD COLUMN     "trackingDetail" TEXT,
ADD COLUMN     "trackingState" "TrackingDeviceState",
ADD COLUMN     "trackingStateAt" TIMESTAMP(3);

