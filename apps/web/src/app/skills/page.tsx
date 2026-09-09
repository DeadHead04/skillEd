import Link from "next/link";
import { listSkills } from "../../lib/data";
import { SkillRegistry } from "../../components/skill-registry";
import { Work, Verdict } from "../../components/ui";
export default async function SkillsPage() {
  const skills = await listSkills();
  return (
    <Work>
      <div className="eyebrow">YOUR LIBRARY</div>
      <Verdict
        title="Skills"
        lede="Your packages, their evidence, and what comes next."
        status={
          <Link className="btn" href="/skill?new=1">
            ＋ Add Skill package
          </Link>
        }
      />
      <SkillRegistry skills={skills} />
    </Work>
  );
}
