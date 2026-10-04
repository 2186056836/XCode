import { Check, DatabaseBackup, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { ZCodeMigrationSection } from "@/settings/ZCodeMigrationSection.js";
import { useZCodeDataMigration } from "@/hooks/useZCodeDataMigration.js";

export function MigrationSection({
  workspacePath,
  workspaceIdentity,
  isDesktop,
}: {
  workspacePath: string | null;
  workspaceIdentity?: string;
  isDesktop?: boolean;
}) {
  const { intl } = useXCodeIntl();
  const migration = useZCodeDataMigration({ isDesktop });
  const result = migration.result;

  const dataMigrationSupported = migration.supported;

  return (
    <div className="space-y-6">
      <Card className="border border-border bg-card py-0 shadow-none">
        <CardHeader className="border-b border-border">
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!dataMigrationSupported || migration.isRunning}
              onClick={() => void migration.start()}
            >
              {migration.isRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <DatabaseBackup className="size-3.5" />
              )}
              {intl.formatMessage({ id: "settings.migration.zcodeData.action" })}
            </Button>
          </CardAction>
          <div className="space-y-1">
            <CardTitle>
              {intl.formatMessage({ id: "settings.migration.zcodeData.title" })}
            </CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: "settings.migration.zcodeData.description" })}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4">
          {!dataMigrationSupported ? (
            <Alert>
              <TriangleAlert className="size-4" />
              <AlertTitle>
                {intl.formatMessage({ id: "settings.migration.unsupported.title" })}
              </AlertTitle>
              <AlertDescription>
                {intl.formatMessage({ id: "settings.migration.unsupported.desktopOnly" })}
              </AlertDescription>
            </Alert>
          ) : null}

          {migration.error ? (
            <Alert>
              <TriangleAlert className="size-4" />
              <AlertTitle>
                {intl.formatMessage({ id: "settings.migration.zcodeData.failedTitle" })}
              </AlertTitle>
              <AlertDescription>
                {intl.formatMessage(
                  { id: "settings.migration.zcodeData.failedDescription" },
                  { error: migration.error },
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {result && !migration.isRunning && (
            <Alert>
              <Check className="size-4" />
              <AlertTitle>
                {intl.formatMessage({ id: "settings.migration.zcodeData.resultTitle" })}
              </AlertTitle>
              <AlertDescription>
                {intl.formatMessage(
                  { id: "settings.migration.zcodeData.resultSummary" },
                  {
                    copied: String(result.copiedFiles ?? 0),
                    skipped: String((result.skipped ?? []).length),
                  },
                )}
                {(result.skipped ?? []).length > 0 ? `（跳过项：${(result.skipped ?? []).slice(0, 3).join(", ")}...` : ""}
              </AlertDescription>
            </Alert>
          )}

          {migration.progress > 0 ? (
            <Alert>
              <Check className="size-4" />
              <AlertTitle>
                {intl.formatMessage({ id: "settings.migration.zcodeData.inProgressTitle" })}
              </AlertTitle>
              <AlertDescription>
                {intl.formatMessage(
                  { id: "settings.migration.zcodeData.inProgressDescription" },
                  { count: migration.progress },
                )}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="border-t border-border pt-6">
        <div className="space-y-1 pb-2">
          <h2 className="text-ui-lg font-semibold text-foreground">
            {intl.formatMessage({ id: "settings.migration.zcode.sectionTitle" })}
          </h2>
          <p className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.migration.zcode.sectionDescription" })}
          </p>
        </div>
        <ZCodeMigrationSection
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          isDesktop={isDesktop}
        />
      </div>
    </div>
  );
}
