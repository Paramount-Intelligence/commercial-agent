/**
 * Ali Azzam LinkedIn experience — authoritative role-level source for founder-bio.
 * Sourced from Ali’s LinkedIn Experience export (pasted Jul 2026).
 */
export type LinkedInRole = {
  /** Stable slug used in heading / replace matching. */
  slug: string;
  company: string;
  title: string;
  dates: string;
  location?: string;
  employmentType?: string;
  /** True when Paramount itself — no "not Paramount" attribution note. */
  isParamount?: boolean;
  /** Employer names that can overlap confidential cases. */
  needsConfidentiality?: boolean;
  /** Catalant practice-community caveat. */
  catalantCaveat?: boolean;
  /** Bore and Bore size caveat. */
  boreCaveat?: boolean;
  /** Achievement bullets from LinkedIn (already cleaned). */
  bullets: string[];
  /** Optional short role summary paragraph from LinkedIn. */
  summary?: string;
};

export const ALI_LINKEDIN_ROLES: LinkedInRole[] = [
  {
    slug: 'paramount-intelligence',
    company: 'Paramount Intelligence',
    title: 'Founder, CEO',
    dates: 'Dec 2025 – Present',
    location: 'New York, United States · Remote',
    isParamount: true,
    summary:
      'We help highly complex organizations build AI-enabled products that bring their operations into the Agentic Age. Core capabilities: applied AI solutions, workflow automation, AI consulting & advisory, and data engineering & analytics.',
    bullets: [
      'Helped a PE-backed portfolio company deploy a voice agent inside their operations, reducing manual ticket routing by 57%.',
      'Built a RAG-powered search system for a manufacturing firm using only their internal SOP docs, now used daily by ops and finance teams.',
      'Partnered with a global consulting firm to architect an AI analytics engine across 6 business units; live in 8 weeks.',
    ],
  },
  {
    slug: 'catalant-practice-community',
    company: 'Catalant',
    title: 'Member of Catalant’s Practice Community — AI Consultant',
    dates: 'Apr 2026 – Present',
    location: 'United States · Remote',
    employmentType: 'Contract',
    catalantCaveat: true,
    summary:
      'Member of Catalant’s Practice Community, an invitation-only group of high-performing independent consultants partnering with Catalant to solve complex business problems. Catalant is the largest community of independent consultants in the world and the pioneer of Consulting 2.0. Ali is Founder & CEO of Paramount Intelligence and works with Fortune 1000 companies, PE-backed businesses, and high-growth startups through this channel. Do not invent a formal Catalant employment title beyond Practice Community membership / AI Consultant positioning.',
    bullets: [
      'Participates in Catalant’s Practice Community as an independent AI consultant alongside founding Paramount Intelligence.',
      'Partners through the Catalant network on complex business problems for enterprise and PE buyers (marketplace channel, not a full-time Catalant employee role).',
    ],
  },
  {
    slug: 'toptal-forward-deployed',
    company: 'Toptal',
    title: 'Forward-Deployed Engineer (Independent Contractor)',
    dates: 'Feb 2026 – Present',
    location: 'Remote',
    employmentType: 'Contract',
    needsConfidentiality: true,
    summary:
      'Embedded directly with enterprise client teams to translate ambiguous business requirements into production-grade LLM, agentic AI, and automation systems through rapid deployment and iteration sprints.',
    bullets: [
      'Architected and shipped two production agentic AI systems on AWS Bedrock AgentCore, combining multi-agent orchestration through Strands SDK, FastAPI and Lambda backends, WebSocket-based React integration, and DynamoDB/S3 state management across 34+ AgentCore runtimes and gateways.',
      'Built an enterprise AI agent discovery and lifecycle management pipeline using four Python Lambda functions, including A2A, MCP, and custom descriptor normalization, Cognito JWT authorization, and three-tier persona-based access control.',
      'Delivered an LLM-powered support automation platform comprising nine interconnected n8n workflows, integrating Anthropic Claude, Retrieval-Augmented Generation (RAG), OpenAI embeddings, Qdrant vector search, PostgreSQL session state, and human-in-the-loop review.',
      'Led rapid deployment and iteration sprints against live stakeholder milestones, resolving 18+ production defects and restoring complete API functionality ahead of an executive demonstration.',
      'Instrumented performance and ROI measurement across AI deployments, including confidence thresholds, ticket deflection, duplicate-context detection, resolution metrics, and automation impact tracking to guide iteration priorities.',
      'Engineered secure, zero-static-credential CI/CD infrastructure using Terraform, Serverless Framework, GitLab OIDC, and AWS-native deployment patterns, enabling repeatable deployments across enterprise client environments.',
    ],
  },
  {
    slug: 'confidential-pe-support-copilot',
    company: 'Confidential Company (PE-backed)',
    title: 'Independent Consultant — AI Solutions Architect',
    dates: 'May 2026 – Present',
    location: 'United States · Remote',
    employmentType: 'Contract',
    needsConfidentiality: true,
    summary:
      'Designing AI-powered enterprise support solutions that combine Retrieval-Augmented Generation (RAG), workflow automation, vector search, and human-in-the-loop AI to improve support operations, knowledge retrieval, and customer experience.',
    bullets: [
      'Designed and implemented an AI-powered Support Copilot that combined Retrieval-Augmented Generation (RAG), enterprise knowledge retrieval, and workflow automation to accelerate customer support operations while maintaining human oversight.',
      'Architected an enterprise AI solution using Anthropic Claude, OpenAI Embeddings, Qdrant, PostgreSQL, and n8n, integrating Freshdesk, Confluence, Jira, and historical support data into a unified knowledge platform.',
      'Built intelligent ticket analysis and AI-assisted response generation workflows that automatically classified issues, retrieved relevant context, processed attachments, and drafted grounded customer responses from enterprise knowledge sources.',
      'Implemented human-in-the-loop approval workflows, confidence-based routing, and governance controls to ensure response quality, explainability, and operational reliability across enterprise support environments.',
      'Delivered a scalable AI support platform that reduced manual research effort, improved response consistency, unified enterprise knowledge retrieval, and accelerated issue resolution through production-grade workflow orchestration.',
    ],
  },
  {
    slug: 'schneider-electric',
    company: 'Schneider Electric',
    title: 'Independent Consultant — AI Advisory & Solutions Architect',
    dates: 'May 2026 – Jun 2026',
    location: 'United States · Remote',
    employmentType: 'Contract',
    needsConfidentiality: true,
    summary:
      'Advised a Fortune 500 industrial automation leader on the strategy and reference architecture for a multimodal Retrieval-Augmented Generation (RAG) co-pilot, defining enterprise AI, knowledge management, and governance capabilities to improve engineering productivity and institutional knowledge access.',
    bullets: [
      'Advised Schneider Electric on the target architecture for a multimodal RAG co-pilot, designing an enterprise AI solution to provide context-aware engineering assistance across 10,000+ technical documents, manuals, schematics, and operating procedures.',
      'Defined a hybrid cloud architecture leveraging Vertex AI RAG Engine, Gemini Multimodal Parser, Cloud Spanner, Google Cloud Storage, Microsoft AI Foundry, and Microsoft Entra ID to support scalable, governed AI-powered engineering knowledge systems.',
      'Designed the knowledge management strategy, multimodal retrieval approach, and enterprise governance model, enabling accurate, source-grounded retrieval across engineering documentation and technical diagrams.',
      'Recommended enterprise AI governance capabilities, including centralized prompt management, identity governance, safety guardrails, and no-code ingestion workflows to simplify long-term operations and model lifecycle management.',
      'Delivered an implementation roadmap and reference architecture for an industrial AI co-pilot, identifying opportunities to reduce SME dependency, accelerate engineer onboarding, improve knowledge accessibility, and reduce control configuration and documentation effort by up to 50%.',
    ],
  },
  {
    slug: 'syngenta',
    company: 'Syngenta',
    title: 'AI Infrastructure & Platform Engineer (Independent Contractor)',
    dates: 'May 2026 – Jun 2026',
    location: 'Remote',
    needsConfidentiality: true,
    summary:
      'Embedded with enterprise client teams through Toptal to design and deliver production-grade AI platforms, multi-agent systems, and cloud-native solutions for Fortune 500 and global enterprise organizations, including Syngenta.',
    bullets: [
      'Architected and implemented a centralized AI Agent Governance & Discovery Platform on AWS AgentCore, providing automated discovery, cataloging, and lifecycle management for AI agents and MCP gateways across enterprise environments.',
      'Built automated ingestion pipelines and governance APIs using AWS Lambda, Python, API Gateway, Cognito, and React, creating a unified registry for AI assets with metadata normalization across A2A, MCP, and custom descriptor formats.',
      'Implemented enterprise-grade role-based access control (RBAC) using Cognito JWT authentication, Lambda authorizers, and persona-based authorization to govern AI asset publishing, approval, and administration workflows.',
      'Designed secure cloud infrastructure and deployment automation using Terraform, Serverless Framework, GitLab CI/CD, CloudFront, and OIDC authentication, enabling repeatable, production-ready deployments across AWS environments.',
      'Delivered a scalable governance platform that improved visibility, operational control, and compliance across enterprise AI initiatives by establishing a single source of truth for AI agents, runtimes, and MCP gateways.',
    ],
  },
  {
    slug: 'gratia',
    company: 'Gratia',
    title: 'Senior AI Consultant',
    dates: 'Oct 2025 – Jun 2026',
    location: 'New York, United States · Remote',
    employmentType: 'Contract',
    summary: 'Supporting enterprise leaders and consulting firms with AI engineering delivery.',
    bullets: [
      'Completed 20+ engagements with consulting buyers including custom automation, data engineering, and LLM system builds.',
      'Helped a healthtech firm move from prototype to usable automation in under 4 weeks by reworking system flow and integrating with existing CRM.',
      'Advised a VC-led startup team on scaling AI infrastructure beyond vendor lock-in and improving latency by 35%.',
    ],
  },
  {
    slug: 'donaldson',
    company: 'Donaldson',
    title: 'Independent Consultant — AI & Engineering',
    dates: 'Dec 2025 – Apr 2026',
    location: 'Remote',
    employmentType: 'Contract',
    needsConfidentiality: true,
    summary:
      'Delivered an AI data project for Donaldson, automating data extraction and structuring fragmented data for decision-making.',
    bullets: [
      'Partnered with Donaldson’s AI leadership to automate and scale data extraction across fragmented sources, improving reliability and processing efficiency.',
      'Developed robust data pipelines to ingest and structure large volumes of external data into standardized formats.',
      'Converted unstructured datasets into analytics-ready outputs, unlocking real-time insights and trend visibility.',
      'Drove faster, more informed commercial decisions by enhancing data quality, accessibility, and system performance across teams.',
    ],
  },
  {
    slug: 'jazz',
    company: 'Jazz (part of VEON)',
    title: 'Senior AI Engineer',
    dates: 'Sep 2023 – Dec 2025',
    location: 'Islāmābād, Pakistan · On-site',
    employmentType: 'Full-time',
    needsConfidentiality: true,
    summary:
      'Embedded within enterprise telecom and digital-service teams to design and deploy production-grade AI, RAG, automation, analytics, and voice-agent solutions supporting a customer base of more than 70 million users.',
    bullets: [
      'Built and deployed a prompt-engineered, Retrieval-Augmented Generation (RAG) customer-support chatbot for a 70M+ telecom user base, reducing live support calls by 30% and generating approximately $2M in annual support cost savings.',
      'Developed a fully automated email-response system using n8n, AWS, and Google Workspace to process thousands of daily customer inquiries with zero manual intervention, eliminating multiple FTE dependencies and saving approximately $300K annually.',
      'Engineered a real-time Customer Pulse Dashboard to aggregate and analyze customer sentiment across social media channels, enabling faster customer-experience decisions and contributing to a 30% improvement in campaign performance and churn-reduction outcomes.',
      'Created AI-powered talent-matching agents that mapped internal and external talent pools against project job descriptions, improving outsourcing and resource-allocation efficiency by 25%.',
      'Integrated conversational voice bots into the sales platform to automate customer engagement and qualification workflows, unlocking approximately $500K in annual margin and revenue gains.',
    ],
  },
  {
    slug: 'bykea',
    company: 'Bykea',
    title: 'Data Scientist I',
    dates: 'Feb 2022 – Sep 2023',
    location: 'Karāchi, Sindh, Pakistan · On-site',
    employmentType: 'Full-time',
    needsConfidentiality: true,
    summary:
      'Embedded within data, pricing, growth, and operations teams to develop production-grade machine learning, customer analytics, and automation solutions across Bykea’s ride-hailing and logistics ecosystem.',
    bullets: [
      'Pioneered a dynamic pricing engine that incorporated real-time demand patterns and responsive fare adjustments, improving pricing efficiency and contributing approximately $4M in additional profit margin.',
      'Engineered an advanced driver-profiling system to analyze partner behavior, performance, and earning potential, increasing driver income by 30% and strengthening Bykea’s value proposition for its partner network.',
      'Optimized marketing budget allocation and customer targeting through Recency, Frequency, and Monetary (RFM) segmentation across millions of users, increasing customer engagement by 20%.',
      'Automated data-processing and operational analytics workflows, reducing processing time by 30% and enabling faster, more reliable decision-making across business teams.',
    ],
  },
  {
    slug: 'daraz',
    company: 'Daraz (Alibaba-backed e-commerce marketplace)',
    title: 'Business Analyst',
    dates: 'Sep 2021 – Feb 2022',
    location: 'Karāchi, Sindh, Pakistan',
    needsConfidentiality: true,
    summary:
      'Embedded within fintech, product, marketing, and logistics teams to establish analytics foundations, strengthen customer intelligence, and improve operational decision-making across Daraz’s nationwide e-commerce platform.',
    bullets: [
      'Established core fintech and product analytics capabilities at Daraz, defining event-tracking requirements through Firebase and Google Tag Manager to improve data-capture accuracy and support a 15% increase in nationwide delivery efficiency.',
      'Led customer churn analysis to identify critical user-experience bottlenecks, translating findings into targeted product improvements that increased customer retention by 3%.',
      'Built and maintained performance dashboards using Looker and Google Data Studio, enabling business and product teams to monitor customer behavior, funnel performance, and operational trends more effectively.',
      'Optimized marketing budget allocation and customer targeting through Recency, Frequency, and Monetary (RFM) profiling across millions of users, increasing engagement with promotions and voucher-led campaigns.',
      'Strengthened Daraz’s competitive position by converting customer and transaction data into actionable commercial insights that improved campaign efficiency, segmentation, and product decision-making.',
    ],
  },
  {
    slug: 'bore-and-bore',
    company: 'Bore and Bore',
    title: 'Data Analyst',
    dates: 'Mar 2021 – Aug 2021',
    location: 'Karāchi, Sindh, Pakistan · On-site',
    employmentType: 'Full-time',
    boreCaveat: true,
    summary:
      'Supported business and operations teams by developing analytics dashboards, automating recurring data processes, and using Google Cloud Platform to improve reporting efficiency and operational visibility.',
    bullets: [
      'Built business intelligence dashboards and recurring performance reports to help stakeholders monitor operational trends, evaluate business performance, and make more informed decisions.',
      'Automated manual data-processing and reporting workflows, reducing repetitive work and improving the speed, consistency, and reliability of business reporting.',
      'Leveraged Google Cloud Platform to organize, process, and analyze business data, creating a more scalable foundation for analytics and reporting activities.',
      'Translated operational data into actionable insights that supported process improvements and contributed to stronger overall operational performance.',
    ],
  },
];
