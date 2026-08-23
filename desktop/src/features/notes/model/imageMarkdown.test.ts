import { describe, expect, it, vi } from "vitest";
import {
  addImagesToNote,
  imageLine,
  imageTitleFromFile,
  imageUrlFromText,
  insertImageMarkdown,
} from "./imageMarkdown";

describe("imageUrlFromText", () => {
  it("takes a plain image URL with a title from its file name", () => {
    expect(imageUrlFromText("https://example.com/board.png")).toEqual({
      url: "https://example.com/board.png",
      title: "board",
    });
  });

  it("ignores query strings when sniffing and naming", () => {
    expect(imageUrlFromText("https://example.com/photo.jpeg?w=640")).toEqual({
      url: "https://example.com/photo.jpeg?w=640",
      title: "photo",
    });
  });

  it("unwraps the Google Images result page to the real picture", () => {
    const google = [
      "https://www.google.com/imgres?q=8k%20wallpaper",
      "&imgurl=https%3A%2F%2Fcdn.wallpapersafari.com%2F41%2F28%2F6yefSc.jpg",
      "&imgrefurl=https%3A%2F%2Fwallpapersafari.com%2F",
      "&w=1920&h=1080",
    ].join("");
    expect(imageUrlFromText(google)).toEqual({
      url: "https://cdn.wallpapersafari.com/41/28/6yefSc.jpg",
      title: "6yefSc",
    });
  });

  it("leaves non-image URLs and non-URL text alone", () => {
    expect(imageUrlFromText("https://example.com/page")).toBeNull();
    expect(imageUrlFromText("https://example.com/notes")).toBeNull();
    expect(imageUrlFromText("just some text")).toBeNull();
    expect(imageUrlFromText("image.png")).toBeNull();
  });

  it("falls back to a plain title for nameless files", () => {
    expect(imageUrlFromText("https://example.com/.png")).toEqual({
      url: "https://example.com/.png",
      title: "Image",
    });
    expect(imageUrlFromText("https://example.com/pic.webp")).toEqual({
      url: "https://example.com/pic.webp",
      title: "pic",
    });
  });
});

describe("imageLine", () => {
  it("embeds a picture by its entry-image reference", () => {
    expect(imageLine("Whiteboard", 3)).toBe("![Whiteboard](entry-image:3)");
  });
});

describe("imageTitleFromFile", () => {
  it("uses the file name without its extension", () => {
    expect(imageTitleFromFile("photo.png")).toBe("photo");
    expect(imageTitleFromFile("my.board.sketch.jpg")).toBe("my.board.sketch");
  });

  it("falls back to a plain label for nameless or dotted files", () => {
    expect(imageTitleFromFile(undefined)).toBe("Image");
    expect(imageTitleFromFile("")).toBe("Image");
    expect(imageTitleFromFile(".png")).toBe("Image");
  });
});

describe("insertImageMarkdown", () => {
  it("inserts at the caret on its own line", () => {
    expect(insertImageMarkdown("hello world", "![x](entry-image:1)", 6)).toEqual({
      text: "hello \n![x](entry-image:1)\nworld",
      caret: 27,
    });
  });

  it("appends at the end without an extra blank line", () => {
    expect(insertImageMarkdown("hello", "![x](entry-image:1)", null)).toEqual({
      text: "hello\n![x](entry-image:1)",
      caret: 25,
    });
  });

  it("does not double up line breaks at the edges", () => {
    expect(insertImageMarkdown("hello\n", "![x](entry-image:1)", 6)).toEqual({
      text: "hello\n![x](entry-image:1)",
      caret: 25,
    });
  });

  it("chains two inserts at the reported caret positions", () => {
    const first = insertImageMarkdown("", "![a](entry-image:1)", 0);
    const second = insertImageMarkdown(first.text, "![b](entry-image:2)", first.caret);
    expect(second.text).toBe("![a](entry-image:1)\n![b](entry-image:2)");
  });
});

describe("addImagesToNote", () => {
  it("uploads the batch and appends each picture at the end", async () => {
    const upload = vi.fn();
    upload.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 });
    const state = {
      current: "hello",
      caret: null as number | null,
      onChange: vi.fn(),
    };
    await addImagesToNote(
      [
        new File(["x"], "board.png", { type: "image/png" }),
        new File(["y"], "diagram.png", { type: "image/png" }),
      ],
      upload,
      state,
    );
    expect(state.current).toBe(
      "hello\n![board](entry-image:1)\n![diagram](entry-image:2)",
    );
    expect(upload).toHaveBeenCalledTimes(2);
    expect(state.onChange).toHaveBeenCalledTimes(2);
    // Each insert lands at the caret the previous one reported.
    expect(state.caret).toBe(state.current.length);
  });

  it("skips files whose upload fails without touching the note", async () => {
    const upload = vi.fn();
    upload.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 3 });
    const state = {
      current: "hello",
      caret: null as number | null,
      onChange: vi.fn(),
    };
    await addImagesToNote(
      [new File(["x"], "bad.png", { type: "image/png" }), new File(["y"], "ok.png", { type: "image/png" })],
      upload,
      state,
    );
    expect(state.current).toBe("hello\n![ok](entry-image:3)");
    expect(state.onChange).toHaveBeenCalledTimes(1);
  });
});
