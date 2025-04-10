const featureRegex = /^\s*Feature:\s.+/m;
const backgroundRegex = /^\s*Background:\s*/m;
const scenarioRegex = /^\s*(Scenario|Scenario Outline):\s.+/gm;
const givenRegex = /^\s*(Given|And\s+Given)\s.+/gm;
const whenRegex = /^\s*(When|And\s+When)\s.+/gm;
const thenRegex = /^\s*(Then|And\s+Then)\s.+/gm;
const andRegex = /^\s*And\s.+/gm;

async function checkFeatureFileFormat(content) {
  // Check basic structure
  const isFeature = featureRegex.test(content);
  const hasBackground = backgroundRegex.test(content);

  // Count scenarios (including Scenario Outlines)
  const scenarios = content.match(scenarioRegex) || [];
  const scenarioCount = scenarios.length;

  // Count steps
  const givens = content.match(givenRegex) || [];
  const whens = content.match(whenRegex) || [];
  const thens = content.match(thenRegex) || [];
  const ands = content.match(andRegex) || [];

  // Background steps count as Given steps
  const backgroundGivens = hasBackground ? 2 : 0; // Assuming standard 2 Given steps in Background

  const totalGivenSteps = givens.length + backgroundGivens;
  const totalSteps = givens.length + whens.length + thens.length + ands.length;

  const isValid =
    isFeature && scenarioCount > 0 && totalSteps > 0 && whens.length >= 1; // At least one When step

  if (isValid) {
    return true;
  } else {
    console.error("Feature file format validation failed:");
    if (!isFeature)
      console.error("- Missing or incorrect 'Feature' definition");
    if (scenarioCount === 0)
      console.error("- No 'Scenario' or 'Scenario Outline' definitions found");
    if (totalSteps === 0) console.error("- No steps found in the feature file");
    if (whens.length < 1)
      console.error("- At least one 'When' step is required");
    return false;
  }
}

module.exports = checkFeatureFileFormat;
