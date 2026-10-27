/** Cron (setiap menit): mengirim antrean kata sandi baru dari Lupa kata sandi dan mengulang pengiriman yang gagal. */
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { log } from "../common/logger";
import { isPrimary } from "../core/instance";
import { processPasswordQueue, requeueStuck } from "../domain/password-reset";

@Injectable()
export class PasswordResetJob {
  private running = false;

  @Cron(CronExpression.EVERY_MINUTE, { name: "password-queue" })
  async run() {
    if (this.running || !isPrimary()) return; // mencegah eksekusi tumpang tindih saat pengiriman email lambat
    this.running = true;
    try {
      await requeueStuck();
      const sent = await processPasswordQueue();
      if (sent) log("info", "mail", "New passwords sent", { count: sent });
    } catch (e) {
      log("error", "mail", `Password queue failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
