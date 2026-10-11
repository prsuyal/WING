"use client";

import { useEffect, useId, useRef, useState } from "react";
import QRCode from "qrcode";
import { motion, useReducedMotion } from "motion/react";
import { Cloud, Icon } from "./artwork";
import { Brand } from "./brand";

export function SetupTrigger({
  className = "button primary",
  children = "Set up Wing",
  openFromLink = false,
}: {
  className?: string;
  children?: React.ReactNode;
  openFromLink?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [qr, setQr] = useState("");
  const reduced = useReducedMotion();
  useEffect(() => {
    const setupUrl = "https://example.com/wing-contact.vcf";
    let active = true;
    QRCode.toDataURL(setupUrl, {
      width: 256,
      margin: 2,
      color: { dark: "#052D68", light: "#FFFDFA" },
      errorCorrectionLevel: "M",
    })
      .then((data) => {
        if (active) setQr(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!openFromLink) return;
    const open = () => {
      if (window.location.hash === "#setup" && !dialog.current?.open) {
        dialog.current?.showModal();
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [openFromLink]);
  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        className={className}
        onClick={() => {
          dialog.current?.showModal();
        }}
      >
        {children}
      </button>
      <dialog
        ref={dialog}
        className="setup-dialog"
        aria-labelledby={titleId}
        onClose={() => trigger.current?.focus()}
        onClick={(event) => {
          if (event.target === dialog.current) close();
        }}
      >
        <motion.div
          className="setup-dialog-inner"
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
        >
          <button
            className="dialog-close"
            aria-label="Close setup"
            onClick={close}
            autoFocus
          >
            <Icon name="close" />
          </button>
          <div className="dialog-brand"><Brand /></div>
          <h2 id={titleId}>
            Your way home
            <br />
            starts here.
          </h2>
          <p>Meet Wing on your phone.</p>
          <div className="qr-frame">
            {qr ? (
              <img
                src={qr}
                width="216"
                height="216"
                alt="QR code to the Wing contact card"
              />
            ) : (
              <span>Contact QR code is loading.</span>
            )}
          </div>
          <p className="dialog-access">Scan the code to add Wing to your contacts.</p>
          <Cloud className="dialog-cloud left" />
          <Cloud className="dialog-cloud right" />
        </motion.div>
      </dialog>
    </>
  );
}
