import { existsSync } from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { uploadAttachments } from "../src/middlewares/upload.js";
import { AppError } from "../src/utils/AppError.js";
import { safeFileName } from "../src/utils/fileName.js";

// A throwaway app around the middleware: it echoes what it parsed, so no account or database is involved.
const app = express();
app.use(express.json());
app.post("/echo", uploadAttachments(), (req: Request, res: Response) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  res.json({
    body: req.body,
    files: files.map((f) => ({ mimetype: f.mimetype, size: f.size, path: f.path })),
  });
});
let failedPaths: string[] = [];
app.post("/fail", uploadAttachments(), (req: Request) => {
  failedPaths = ((req.files ?? []) as Express.Multer.File[]).map((f) => f.path);
  throw AppError.conflict("Ticket is closed");
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: AppError, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.statusCode ?? 500).json({ error: err.message });
});

const MB = 1024 * 1024;
const bytes = (n: number) => Buffer.alloc(n, 1);

function post(path = "/echo") {
  return request(app).post(path).field("body", "hello");
}

const gone = (paths: string[]) => vi.waitFor(() => expect(paths.filter(existsSync)).toEqual([]));

describe("uploadAttachments", () => {
  it("accepts each kind of file and removes the temp files after the response", async () => {
    const res = await post()
      .attach("attachments", bytes(10), { filename: "photo.jpg", contentType: "image/jpeg" })
      .attach("attachments", bytes(10), { filename: "clip.mp4", contentType: "video/mp4" })
      .attach("attachments", bytes(10), { filename: "voice.m4a", contentType: "audio/x-m4a" })
      .attach("attachments", bytes(10), { filename: "receipt.pdf", contentType: "application/pdf" })
      .attach("attachments", bytes(10), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.body).toEqual({ body: "hello" });
    expect(res.body.files.map((f: { mimetype: string }) => f.mimetype)).toEqual([
      "image/jpeg",
      "video/mp4",
      "audio/x-m4a",
      "application/pdf",
      "text/plain",
    ]);
    await gone(res.body.files.map((f: { path: string }) => f.path));
  });

  it("removes the temp files when the handler fails", async () => {
    const res = await post("/fail").attach("attachments", bytes(10), {
      filename: "photo.png",
      contentType: "image/png",
    });
    expect(res.status).toBe(409);
    expect(failedPaths).toHaveLength(1);
    await gone(failedPaths);
  });

  it("refuses an unsupported type", async () => {
    const res = await post().attach("attachments", bytes(10), {
      filename: "run.exe",
      contentType: "application/x-msdownload",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(
      /^Unsupported file type: application\/x-msdownload\. Allowed: images/,
    );
  });

  it("refuses a sixth file and a file under another field", async () => {
    let six = post();
    for (let i = 0; i < 6; i++) {
      six = six.attach("attachments", bytes(10), {
        filename: `p${i}.jpg`,
        contentType: "image/jpeg",
      });
    }
    const tooMany = await six;
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toBe("You can attach up to 5 files, under the 'attachments' field");

    const wrongField = await post().attach("evidence", bytes(10), {
      filename: "p.jpg",
      contentType: "image/jpeg",
    });
    expect(wrongField.body.error).toBe(
      "You can attach up to 5 files, under the 'attachments' field",
    );
  });

  it.each([
    ["image/png", "Images can be at most 10MB each", 10 * MB],
    ["audio/mpeg", "Audio files can be at most 16MB each", 16 * MB],
    ["application/pdf", "Documents can be at most 10MB each", 10 * MB],
  ])("enforces the %s cap", async (contentType, error, cap) => {
    const atCap = await post().attach("attachments", bytes(cap), { filename: "f", contentType });
    expect(atCap.status, JSON.stringify(atCap.body)).toBe(200);
    await gone(atCap.body.files.map((f: { path: string }) => f.path));

    const over = await post().attach("attachments", bytes(cap + 1), { filename: "f", contentType });
    expect(over.status).toBe(400);
    expect(over.body.error).toBe(error);
  });

  it("caps videos at 50MB", async () => {
    const over = await post().attach("attachments", bytes(50 * MB + 1), {
      filename: "long.mp4",
      contentType: "video/mp4",
    });
    expect(over.status).toBe(400);
    expect(over.body.error).toBe("File too large. Maximum size is 50MB");
  });

  it("lets JSON through untouched, with no files", async () => {
    const res = await request(app).post("/echo").send({ body: "just text" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ body: { body: "just text" }, files: [] });
  });
});

describe("safeFileName", () => {
  it("drops paths and unsafe characters, and falls back when nothing is left", () => {
    expect(safeFileName("../../etc/passwd", "txt")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\receipt.pdf", "pdf")).toBe("receipt.pdf");
    expect(safeFileName('bad"<name>|?.png', "png")).toBe("badname.png");
    expect(safeFileName("\u0000\u0007", "jpg")).toBe("file.jpg");
    expect(safeFileName("a".repeat(300), "txt")).toHaveLength(120);
  });
});
