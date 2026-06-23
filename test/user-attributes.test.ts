import test from "node:test";
import assert from "node:assert/strict";

import {
  matchesUserAttribute,
  mergeUserPublicAttributes,
  normalizeAttributeKey,
  normalizeAttributeValue,
  normalizeUserPublicAttribute,
} from "../src/user-attributes.js";
import type { UserPublicAttribute } from "../src/types.js";

test("normalizes attribute keys and values for matching", () => {
  assert.equal(normalizeAttributeKey(" Group "), "group");
  assert.equal(normalizeAttributeKey("Skill"), "skill");
  assert.equal(normalizeAttributeValue(" TypeScript "), "typescript");
  assert.equal(normalizeAttributeValue(" 实验室 "), "实验室");
});

test("normalizes valid tag attributes without a key", () => {
  assert.deepEqual(
    normalizeUserPublicAttribute({
      kind: "tag",
      key: "ignored",
      value: " ResearchLoop ",
      label: " ResearchLoop Team ",
      source: "USER.md",
    }),
    {
      kind: "tag",
      value: "ResearchLoop",
      label: "ResearchLoop Team",
      source: "USER.md",
    },
  );
});

test("normalizes valid structured attributes with key and source", () => {
  assert.deepEqual(
    normalizeUserPublicAttribute({
      kind: "structured",
      key: " Group ",
      value: " 实验室 ",
      label: " 实验室成员 ",
      source: "profile",
    }),
    {
      kind: "structured",
      key: "group",
      value: "实验室",
      label: "实验室成员",
      source: "profile",
    },
  );
});

test("filters invalid attributes without throwing", () => {
  const invalidValues = [
    undefined,
    null,
    "group=lab",
    { kind: "tag", value: "lab", label: "lab", source: "profile" },
    { kind: "tag", value: " ", label: "lab", source: "USER.md" },
    { kind: "structured", key: "group", value: "lab", label: "lab", source: "USER.md" },
    { kind: "structured", key: " ", value: "lab", label: "lab", source: "profile" },
    { kind: "structured", key: "group", value: "", label: "lab", source: "profile" },
  ];

  for (const value of invalidValues) {
    assert.equal(normalizeUserPublicAttribute(value), undefined);
  }
});

test("merges attributes with kind-specific dedupe keys", () => {
  const userMdTags: UserPublicAttribute[] = [
    { kind: "tag", value: " 实验室 ", label: "实验室", source: "USER.md" },
    { kind: "tag", value: "实验室", label: "Duplicate label", source: "USER.md" },
    { kind: "tag", value: "ResearchLoop", label: "ResearchLoop", source: "USER.md" },
  ];
  const profileAttributes: UserPublicAttribute[] = [
    { kind: "structured", key: "group", value: "实验室", label: "实验室", source: "profile" },
    { kind: "structured", key: "GROUP", value: "实验室", label: "Duplicate group", source: "profile" },
    { kind: "structured", key: "skill", value: " TypeScript ", label: " TypeScript ", source: "profile" },
  ];

  assert.deepEqual(mergeUserPublicAttributes(userMdTags, profileAttributes), [
    { kind: "tag", value: "实验室", label: "实验室", source: "USER.md" },
    { kind: "tag", value: "ResearchLoop", label: "ResearchLoop", source: "USER.md" },
    { kind: "structured", key: "group", value: "实验室", label: "实验室", source: "profile" },
    { kind: "structured", key: "skill", value: "TypeScript", label: "TypeScript", source: "profile" },
  ]);
});

test("merge filters invalid attributes", () => {
  assert.deepEqual(
    mergeUserPublicAttributes(
      [
        { kind: "tag", value: "", label: "empty", source: "USER.md" },
        { kind: "tag", value: "lab", label: "lab", source: "USER.md" },
      ] as UserPublicAttribute[],
      [
        { kind: "structured", key: "", value: "lab", label: "lab", source: "profile" },
        { kind: "structured", key: "project", value: "mesh", label: "Mesh", source: "profile" },
      ] as UserPublicAttribute[],
    ),
    [
      { kind: "tag", value: "lab", label: "lab", source: "USER.md" },
      { kind: "structured", key: "project", value: "mesh", label: "Mesh", source: "profile" },
    ],
  );
});

test("matches tag attributes only by normalized tag value", () => {
  const tag: UserPublicAttribute = {
    kind: "tag",
    value: " ResearchLoop ",
    label: "ResearchLoop",
    source: "USER.md",
  };

  assert.equal(matchesUserAttribute(tag, { kind: "tag", value: "researchloop" }), true);
  assert.equal(matchesUserAttribute(tag, { kind: "tag", value: "实验室" }), false);
  assert.equal(
    matchesUserAttribute(tag, { kind: "structured", key: "project", value: "ResearchLoop" }),
    false,
  );
});

test("matches structured attributes by normalized key and value", () => {
  const attribute: UserPublicAttribute = {
    kind: "structured",
    key: "Skill",
    value: " TypeScript ",
    label: "TypeScript",
    source: "profile",
  };

  assert.equal(matchesUserAttribute(attribute, { kind: "structured", key: "skill", value: "typescript" }), true);
  assert.equal(matchesUserAttribute(attribute, { kind: "structured", key: "role", value: "typescript" }), false);
  assert.equal(matchesUserAttribute(attribute, { kind: "tag", value: "typescript" }), false);
});
