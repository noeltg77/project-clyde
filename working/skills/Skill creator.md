# ---

**Version:** 1.1
**Created:** (see history)
**Last Updated:** 2026-02-23 20:15 UTC
**Update Reason:** Simplified to single SKILL.md file workflow only — removed all references to bundled resources (scripts/, references/, assets/), init_skill.py, package_skill.py, packaging/validation steps, and progressive disclosure patterns for multi-file skills. Added explicit instruction to save completed skills to the skills/ working folder.

---

---
name: skill-creator
description: Guide for creating effective agent skills as single markdown files. Use when creating a new skill or updating an existing skill for the agent team.
---

# Skill Creator

Guide for creating effective skills as single `.md` files saved to the `skills/` working folder.

## What is a Skill

A skill is a single markdown file that gives an agent specialised knowledge, workflows, or domain expertise. It transforms a general-purpose agent into a specialist for a specific task type.

**A skill is just one file:** `skill-name.md` — saved directly to the `skills/` folder.

## Skill File Structure

Every skill file has two parts:

### 1. YAML Frontmatter (required)

```yaml
---
name: skill-name
description: What this skill does and when to use it. Be specific — this is the primary trigger mechanism. Include concrete examples of when the skill applies.
---
```

- `name` — kebab-case identifier
- `description` — comprehensive trigger description. Include both what the skill does AND when to use it. This is what Claude reads to decide whether to activate the skill, so be thorough.

**Do not include any other frontmatter fields.**

### 2. Markdown Body (required)

The instructions, workflows, and domain knowledge the agent needs. Written in imperative form.

## Core Principles

### Be Concise

The context window is shared. Claude is already smart — only include knowledge Claude doesn't already have. Challenge every paragraph: "Does this justify its token cost?"

Prefer concise examples over verbose explanations.

### Match Specificity to Risk

- **High freedom** (general guidance) — when multiple approaches are valid
- **Medium freedom** (pseudocode/patterns) — when a preferred pattern exists but variation is acceptable
- **Low freedom** (exact steps) — when operations are fragile and consistency is critical

### Keep It Lean

- Target under 500 lines
- Only include what the agent genuinely needs to do the job
- No README files, changelogs, installation guides, or meta-documentation
- No "When to Use This Skill" sections in the body — that belongs in the frontmatter `description`

## Creation Process

### Step 1 — Understand the Skill

Clarify the scope with concrete examples:
- What tasks should this skill handle?
- What would a user say that should trigger it?
- What does good output look like?

Skip if the skill's purpose is already clear.

### Step 2 — Write the Skill File

Create a single `.md` file with:

1. **Frontmatter** — `name` and `description` (comprehensive trigger description)
2. **Body** — procedural instructions, domain knowledge, quality criteria, and examples

Writing guidelines:
- Use imperative/infinitive form ("Extract the data", not "You should extract the data")
- Include concrete examples where they add clarity
- Structure with clear headings for scanability
- Focus on what Claude doesn't already know

### Step 3 — Save to Skills Folder

**Save the completed skill file to the `skills/` working folder.** Use the naming convention `Skill-name.md` (e.g., `Social media post.md`, `Code review.md`).

Then register it in the agent registry using `create_skill` or `update_skill` and assign it to the relevant agent(s).

### Step 4 — Iterate

After real usage, refine the skill based on what worked and what didn't. Update via `update_skill` with a clear reason for the change.

---

## Version History

- v1.1 (2026-02-23 20:15 UTC): Simplified to single SKILL.md file workflow only — removed all references to bundled resources (scripts/, references/, assets/), init_skill.py, package_skill.py, packaging/validation steps, and progressive disclosure patterns for multi-file skills. Added explicit instruction to save completed skills to the skills/ working folder.
- v1.0: Previous version
