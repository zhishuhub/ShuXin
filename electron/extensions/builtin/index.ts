import { registerBuiltinExtension } from '../loader';
import { createClawHubMarketplaceExtension } from './clawhub-marketplace';
import { createDiagnosticsExtension } from './diagnostics';
import { createShuxinExtension } from './shuxin';
import { ZHISHU_MANAGED_AI } from '../../shuxin/managed';

export function registerAllBuiltinExtensions(): void {
  registerBuiltinExtension('builtin/clawhub-marketplace', createClawHubMarketplaceExtension);
  registerBuiltinExtension('builtin/diagnostics', createDiagnosticsExtension);
  if (ZHISHU_MANAGED_AI) registerBuiltinExtension('builtin/shuxin', createShuxinExtension);
}
