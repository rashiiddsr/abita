/** Cron (setiap 5 menit): pengingat check out dan pemberitahuan check out tidak tercatat. Lihat domain/checkout-reminders.ts. */
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { log } from "../common/logger";
import { isPrimary } from "../core/instance";
import { remindCheckouts } from "../domain/checkout-reminders";

@Injectable()
export class CheckoutReminderJob {
  private running = false;

  @Cron(CronExpression.EVERY_5_MINUTES, { name: "checkout-reminders" })
  async run() {
    if (this.running || !isPrimary()) return;
    this.running = true;
    try {
      const [reminded, missed] = await remindCheckouts();
      if (reminded || missed) log("info", "attendance", "Checkout reminders sent", { reminded, missed });
    } catch (e) {
      log("error", "attendance", `Checkout reminders failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
