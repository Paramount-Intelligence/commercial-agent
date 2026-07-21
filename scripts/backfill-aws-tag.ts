/**
 * ADDITIVE: insert bare CaseTech name='AWS' for cases that have AWS-family
 * service tags but lack the AWS tag. Does NOT modify TechAlias or other tags.
 *
 *   npm run aws:tag:dry
 *   npm run aws:tag
 */
import { prisma } from '../lib/db';
import { searchCases } from '../lib/retrieval/searchCases';

const DRY = process.argv.includes('--dry-run');

/**
 * Editable: CaseTech.name values that imply the case uses AWS.
 * Bare 'AWS' is intentionally NOT listed (already the target tag).
 */
const AWS_FAMILY = [
  'AWS Bedrock',
  'AWS Lambda',
  'Amazon S3',
  'Amazon Kendra',
  'Amazon API Gateway',
  'Amazon CloudFront',
  'Amazon DynamoDB',
  'Amazon CloudWatch',
  'Amazon Cognito',
  'Amazon EC2',
  'Amazon Titan',
  'AWS CDK',
  'AWS CloudFormation',
  'AWS CodeBuild',
  'AWS IAM',
  'AWS Secrets Manager',
  'AWS X-Ray',
] as const;

const TARGET = 'AWS';

const AGENTCORE_TITLES = [
  'AI Agent Governance & Discovery Platform on AWS AgentCore',
  'Multi Agent Shopping Intelligence on AWS Bedrock AgentCore',
] as const;

async function main() {
  console.log('=== AWS-family set (editable in script) ===');
  for (const t of AWS_FAMILY) console.log(`  - ${t}`);
  console.log(`  (${AWS_FAMILY.length} tags)\n`);

  const cases = await prisma.caseStudy.findMany({
    select: {
      id: true,
      title: true,
      techTags: { select: { name: true } },
    },
    orderBy: { title: 'asc' },
  });

  const familySet = new Set<string>(AWS_FAMILY);
  const alreadyAws = new Set(
    cases.filter((c) => c.techTags.some((t) => t.name === TARGET)).map((c) => c.id),
  );

  type Plan = {
    id: string;
    title: string;
    familyTags: string[];
  };

  const plan: Plan[] = [];
  for (const c of cases) {
    const familyTags = c.techTags
      .map((t) => t.name)
      .filter((n) => familySet.has(n))
      .sort();
    if (familyTags.length === 0) continue;
    if (alreadyAws.has(c.id)) continue;
    plan.push({ id: c.id, title: c.title, familyTags });
  }

  const currentAwsCount = alreadyAws.size;
  const projected = currentAwsCount + plan.length;

  console.log('=== CASES THAT WOULD GET CaseTech name=AWS ===\n');
  if (plan.length === 0) {
    console.log('  (none — all AWS-family cases already have bare AWS)');
  } else {
    for (const p of plan) {
      console.log(`  ${p.title}`);
      console.log(`    id: ${p.id}`);
      console.log(`    AWS-family: ${p.familyTags.join(', ')}`);
      console.log(`    would add: ${TARGET}`);
      console.log('');
    }
  }

  console.log('=== COUNTS ===');
  console.log(`  cases needing new AWS tag: ${plan.length}`);
  console.log(`  current bare-AWS cases:    ${currentAwsCount}`);
  console.log(`  projected AWS matches:     ${projected} (was ${currentAwsCount})`);

  const techTotalBefore = await prisma.caseTech.count();
  console.log(`  CaseTech total now:        ${techTotalBefore}`);

  if (DRY) {
    console.log('\nDRY RUN — no writes. Edit AWS_FAMILY then re-run dry if needed.');
    return;
  }

  console.log('\n=== INSERTING ===');
  const result = await prisma.caseTech.createMany({
    data: plan.map((p) => ({ caseId: p.id, name: TARGET })),
    skipDuplicates: true, // @@unique([caseId, name])
  });
  console.log(`  rows inserted: ${result.count}`);

  const techTotalAfter = await prisma.caseTech.count();
  const expectedTech = techTotalBefore + result.count;
  if (techTotalAfter === expectedTech) {
    console.log(`PASS  CaseTech total ${techTotalBefore} + ${result.count} = ${techTotalAfter}`);
  } else {
    console.log(
      `FAIL  CaseTech total expected ${expectedTech}, got ${techTotalAfter}`,
    );
    process.exitCode = 1;
  }

  console.log('\n=== searchCases({ techs: ["AWS"], limit: 45 }) ===');
  const ranked = await searchCases({ techs: ['AWS'], limit: 45 });
  const matched = ranked.filter((r) => r.techScore >= 1);
  console.log(`  techScore>=1: ${matched.length} (projected ${projected})`);
  if (matched.length === projected) {
    console.log(`PASS  match count == projected`);
  } else {
    console.log(`FAIL  match count ${matched.length} != projected ${projected}`);
    process.exitCode = 1;
  }

  for (const title of AGENTCORE_TITLES) {
    const hit = ranked.find((r) => r.title === title);
    if (!hit) {
      console.log(`FAIL  ABSENT: ${title}`);
      process.exitCode = 1;
    } else if (hit.techScore < 1) {
      console.log(
        `FAIL  techScore=${hit.techScore} rank=${ranked.indexOf(hit) + 1}: ${title}`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `PASS  techScore=${hit.techScore} rank=${ranked.indexOf(hit) + 1}: ${title}`,
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
