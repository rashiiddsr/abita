/** Hubungi bantuan: kontak diatur Admin SDM (Pengaturan › Kontak bantuan). Email dan WhatsApp -> pilih dulu. */
import { Mail, MessageCircle } from "lucide-react";
import { useState } from "react";
import { useConfig } from "../lib/session";
import { ListRow, Sheet, useToast } from "./ui";

export function useHelpdesk(text = "Halo Admin SDM, saya butuh bantuan aplikasi ABiTA.") {
  const cfg = useConfig();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const wa = (cfg.data?.helpdesk_whatsapp ?? "").replace(/\D/g, "");
  const email = (cfg.data?.helpdesk_email ?? "").trim();
  const go = (kind: "wa" | "email") => {
    setOpen(false);
    const url =
      kind === "wa"
        ? `https://api.whatsapp.com/send?phone=${wa}&text=${encodeURIComponent(text)}`
        : `mailto:${email}?subject=${encodeURIComponent("Bantuan aplikasi ABiTA")}&body=${encodeURIComponent(text)}`;
    window.open(url, kind === "wa" ? "_blank" : "_self");
  };
  const openHelp = async () => {
    const fresh = (await cfg.refetch()).data ?? cfg.data; // ambil kontak terbaru
    const w = (fresh?.helpdesk_whatsapp ?? "").replace(/\D/g, "");
    const e = (fresh?.helpdesk_email ?? "").trim();
    if (!w && !e) return toast("Kontak bantuan belum diatur. Hubungi Admin SDM secara langsung.", "bad");
    if (w && !e) return go("wa");
    if (e && !w) return go("email");
    setOpen(true);
  };
  const sheet = (
    <Sheet open={open} onClose={() => setOpen(false)} title="Hubungi bantuan">
      <div className="-mx-5 divide-y divide-line">
        <ListRow icon={<MessageCircle size={19} />} iconTone="ok" title="WhatsApp" subtitle={`+${wa}`} onClick={() => go("wa")} />
        <ListRow icon={<Mail size={19} />} iconTone="brand" title="Email" subtitle={email} onClick={() => go("email")} />
      </div>
    </Sheet>
  );
  return { openHelp, sheet };
}
