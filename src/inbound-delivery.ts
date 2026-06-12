import { spawn } from "node:child_process";
import type {
  InboundDeliveryAdapter,
  InboundDeliveryRequest,
  InboundDeliveryResult,
} from "./types.js";

export type DeliveryLogger = {
  info?: (message: string) => void;
  debug?: (message: string) => void;
  warn?: (message: string) => void;
};

export function createOpenClawCliInboundDelivery(options?: {
  command?: string;
  logger?: DeliveryLogger;
}): InboundDeliveryAdapter {
  const command = options?.command ?? "openclaw";
  const logger = options?.logger;

  return {
    deliver(request: InboundDeliveryRequest): Promise<InboundDeliveryResult> {
      const args = [
        "message",
        "send",
        "--channel",
        request.channel,
        "--target",
        request.target,
        "--message",
        request.text,
      ];

      logger?.debug?.(
        `[libp2p-mesh] Forwarding inbound delivery via CLI: ${command} ${args.join(" ")}`,
      );

      return new Promise((resolve) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let settled = false;

        const finish = (result: InboundDeliveryResult): void => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(result);
        };

        child.stdout.on("data", (chunk: Buffer) => {
          stdout.push(chunk);
        });

        child.stderr.on("data", (chunk: Buffer) => {
          stderr.push(chunk);
        });

        child.on("error", (err) => {
          finish({
            ok: false,
            channel: request.channel,
            target: request.target,
            error: String(err),
          });
        });

        child.on("close", (code) => {
          if (code === 0) {
            logger?.info?.(
              `[libp2p-mesh] Delivered inbound message to ${request.channel}/${request.target}`,
            );
            finish({
              ok: true,
              channel: request.channel,
              target: request.target,
            });
            return;
          }

          const stderrText = Buffer.concat(stderr).toString().trim();
          const stdoutText = Buffer.concat(stdout).toString().trim();

          finish({
            ok: false,
            channel: request.channel,
            target: request.target,
            error:
              stderrText ||
              stdoutText ||
              `openclaw message send exited with code ${code}`,
          });
        });
      });
    },
  };
}
