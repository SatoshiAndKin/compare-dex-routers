/**
 * Results store for quote comparison results.
 */

import type { components } from '../../generated/api-types.js';

type CompareResult = components['schemas']['CompareResult'];

class ResultsStore {
  result = $state<CompareResult | null>(null);
  error = $state<string | null>(null);
  isLoading = $state(false);
}

export const resultsStore = new ResultsStore();
