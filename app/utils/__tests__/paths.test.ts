import { describe, expect, it } from "vitest";
import { isAbsolute, isBareName, normalize, toServerDirectory } from "../paths";

describe("isAbsolute", () => {
  it("rejects empty / relative paths", () => {
    expect(isAbsolute("")).toBe(false);
    expect(isAbsolute("foo/bar")).toBe(false);
    expect(isAbsolute("./foo")).toBe(false);
  });

  it("accepts POSIX absolute paths", () => {
    expect(isAbsolute("/usr/local/bin")).toBe(true);
  });

  it("accepts Windows drive paths", () => {
    expect(isAbsolute("C:\\Users\\Min")).toBe(true);
    expect(isAbsolute("D:/code/x")).toBe(true);
  });

  it("accepts UNC paths", () => {
    expect(isAbsolute("\\\\server\\share")).toBe(true);
  });

  it("rejects bare drive without separator", () => {
    expect(isAbsolute("C:foo")).toBe(false);
  });
});

describe("normalize", () => {
  it("replaces backslashes with forward slashes", () => {
    expect(normalize("a\\b\\c")).toBe("a/b/c");
  });

  it("handles mixed separators", () => {
    expect(normalize("D:\\code/foo\\bar")).toBe("D:/code/foo/bar");
  });

  it("passes through forward-slash paths unchanged", () => {
    expect(normalize("a/b/c")).toBe("a/b/c");
  });
});

describe("isBareName", () => {
  it("returns true for a single-segment name", () => {
    expect(isBareName("my-project")).toBe(true);
    expect(isBareName("code")).toBe(true);
  });

  it("returns false for paths with separators", () => {
    expect(isBareName("a/b")).toBe(false);
    expect(isBareName("a\\b")).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(isBareName("")).toBe(false);
  });
});

describe("toServerDirectory", () => {
  it("returns undefined for empty / whitespace input", () => {
    expect(toServerDirectory(undefined)).toBeUndefined();
    expect(toServerDirectory("")).toBeUndefined();
    expect(toServerDirectory("   ")).toBeUndefined();
  });

  it("returns undefined for relative paths", () => {
    expect(toServerDirectory("foo/bar")).toBeUndefined();
    expect(toServerDirectory("./code")).toBeUndefined();
  });

  it("returns the trimmed absolute path", () => {
    expect(toServerDirectory("  /home/user/code  ")).toBe("/home/user/code");
    expect(toServerDirectory("C:\\code\\x")).toBe("C:\\code\\x");
  });
});
