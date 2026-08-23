// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TagEditor from "./TagEditor";

afterEach(cleanup);

const renderEditor = (initial: string[] = [], suggestions: string[] = []) => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <TagEditor
      initial={initial}
      suggestions={suggestions}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose };
};

const search = () => screen.getByLabelText<HTMLInputElement>("Search or add a tag");

describe("TagEditor", () => {
  it("shows a typed tag as a checked row the moment Enter adds it", () => {
    renderEditor([], ["cl"]);
    fireEvent.change(search(), { target: { value: "Link" } });
    fireEvent.keyDown(search(), { key: "Enter" });

    // The create row is gone, the tag sits in the list, the field cleared.
    expect(screen.queryByText("Create “Link”")).toBeNull();
    expect(screen.getByText("Link")).not.toBeNull();
    expect(search().value).toBe("");
    expect(screen.getByText("1 selected")).not.toBeNull();
  });

  it("Enter on an exact tag name toggles it", () => {
    renderEditor([], ["cl"]);
    fireEvent.change(search(), { target: { value: "cl" } });

    fireEvent.keyDown(search(), { key: "Enter" });
    expect(screen.getByText("1 selected")).not.toBeNull();

    fireEvent.keyDown(search(), { key: "Enter" });
    expect(screen.getByText("0 selected")).not.toBeNull();
  });

  it("× takes a tag off this note only, and Save sends the rest", () => {
    const { onSave } = renderEditor(["cl", "leetcode"], ["cl", "leetcode"]);
    fireEvent.click(screen.getByLabelText("Remove leetcode from this note"));

    expect(screen.getByText("1 selected")).not.toBeNull();

    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(["cl"]);
  });

  it("Cancel discards everything — nothing is saved", () => {
    const { onSave, onClose } = renderEditor([], ["cl"]);
    fireEvent.change(search(), { target: { value: "Link" } });
    fireEvent.keyDown(search(), { key: "Enter" });

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
