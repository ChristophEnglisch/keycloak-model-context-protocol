import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness, textOf } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());

describe("group_list", () => {
  it("passes search and explicit realm, requests max+1 and detects hasMore", async () => {
    h = await startHarness();
    h.kc.groups.find.mockResolvedValue([
      { id: "g1", name: "devs", path: "/devs", subGroupCount: 2, attributes: { x: ["y"] } },
      { id: "g2", name: "ops", path: "/ops" },
      { id: "g3", name: "qa", path: "/qa" },
    ]);
    const result = await h.call("group_list", { realm: "shop", search: "d", first: 5, max: 2 });
    expect(h.kc.groups.find).toHaveBeenCalledWith({
      realm: "shop",
      first: 5,
      max: 3,
      briefRepresentation: true,
      search: "d",
    });
    expect(result.structuredContent).toEqual({
      realm: "shop",
      items: [
        { id: "g1", name: "devs", path: "/devs", subGroupCount: 2 },
        { id: "g2", name: "ops", path: "/ops" },
      ],
      first: 5,
      max: 2,
      hasMore: true,
    });
    expect(JSON.stringify(result)).not.toContain("attributes");
  });

  it("enforces the allowlist", async () => {
    h = await startHarness({ allowedRealms: ["shop"] });
    const result = await h.call("group_list", { realm: "other" });
    expect(result.isError).toBe(true);
    expect(h.kc.groups.find).not.toHaveBeenCalled();
  });
});

describe("group_members_list", () => {
  it("lists a safe user subset with pagination", async () => {
    h = await startHarness();
    h.kc.groups.listMembers.mockResolvedValue([
      { id: "u1", username: "a", attributes: { s: ["x"] }, credentials: [] },
      { id: "u2", username: "b" },
    ]);
    const result = await h.call("group_members_list", { realm: "shop", groupId: "g1", max: 1 });
    expect(h.kc.groups.listMembers).toHaveBeenCalledWith({
      realm: "shop",
      id: "g1",
      first: 0,
      max: 2,
      briefRepresentation: true,
    });
    expect(result.structuredContent).toEqual({
      realm: "shop",
      groupId: "g1",
      items: [{ id: "u1", username: "a" }],
      first: 0,
      max: 1,
      hasMore: true,
    });
    expect(JSON.stringify(result)).not.toContain("attributes");
  });

  it("rejects path traversal in groupId", async () => {
    h = await startHarness();
    const result = await h.call("group_members_list", { realm: "shop", groupId: "../x" });
    expect(result.isError).toBe(true);
    expect(h.kc.groups.listMembers).not.toHaveBeenCalled();
  });
});

describe("user_group_add", () => {
  it("adds the user to the group", async () => {
    h = await startHarness();
    h.kc.users.addToGroup.mockResolvedValue("");
    const result = await h.call("user_group_add", { realm: "shop", userId: "u1", groupId: "g1" });
    expect(h.kc.users.addToGroup).toHaveBeenCalledWith({ realm: "shop", id: "u1", groupId: "g1" });
    expect(result.structuredContent).toEqual({
      userId: "u1",
      groupId: "g1",
      realm: "shop",
      added: true,
    });
  });

  it("is blocked in master", async () => {
    h = await startHarness();
    const result = await h.call("user_group_add", { realm: "master", userId: "u", groupId: "g" });
    expect(result.isError).toBe(true);
    expect(h.kc.users.addToGroup).not.toHaveBeenCalled();
  });
});

describe("user_group_remove", () => {
  it("previews with username and group path, without removing", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob" });
    h.kc.groups.findOne.mockResolvedValue({ id: "g1", name: "devs", path: "/eng/devs" });
    const result = await h.call("user_group_remove", {
      realm: "shop",
      userId: "u1",
      groupId: "g1",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/remove user 'bob' from group '\/eng\/devs'.*confirm: true/s);
    expect(h.kc.users.delFromGroup).not.toHaveBeenCalled();
  });

  it("removes with confirm: true", async () => {
    h = await startHarness();
    h.kc.users.delFromGroup.mockResolvedValue("");
    const result = await h.call("user_group_remove", {
      realm: "shop",
      userId: "u1",
      groupId: "g1",
      confirm: true,
    });
    expect(h.kc.users.delFromGroup).toHaveBeenCalledWith({
      realm: "shop",
      id: "u1",
      groupId: "g1",
    });
    expect(result.structuredContent).toMatchObject({ removed: true });
  });

  it("reports an unknown group in the preview", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob" });
    h.kc.groups.findOne.mockResolvedValue(undefined);
    const result = await h.call("user_group_remove", { realm: "shop", userId: "u1", groupId: "x" });
    expect(textOf(result)).toMatch(/Group x does not exist/);
  });
});
