/** Cron (setiap jam): pemberitahuan file perusahaan yang menunggu tanggal tampil dan pengingat folder. Lihat domain/files.ts. */
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { log } from "../common/logger";
import { isPrimary } from "../core/instance";
import { sendDueFolderNotices } from "../domain/files";

@Injectable()
export class DocumentNoticeJob {
  private running = false;

  @Cron(CronExpression.EVERY_HOUR, { name: "document-notices" })
  async run() {
    if (this.running || !isPrimary()) return;
    this.running = true;
    try {
      const [announced, reminded] = await sendDueFolderNotices();
      if (announced || reminded) log("info", "files", "Document notices sent", { announced, reminded });
    } catch (e) {
      log("error", "files", `Document notices failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
