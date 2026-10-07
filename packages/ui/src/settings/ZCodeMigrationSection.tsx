import { useMemo } from "react";
import { Loader2, RefreshCcw, TriangleAlert } from "lucide-react";
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
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeSessionMigration } from "@/hooks/useZCodeSessionMigration.js";
import type {
  ClaudeMigrationRange,
  ClaudeMigrationWorkspaceFilterMode,
} from "@/hooks/useClaudeSessionMigration.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { MigrationCandidatesCard } from "@/settings/MigrationCandidatesCard.js";

const RANGE_OPTIONS: readonly ClaudeMigrationRange[] = ["7d", "30d", "90d", "all"];

export function ZCodeMigrationSection({
  workspacePath,
  workspaceIdentity,
  isDesktop,
}: {
  workspacePath: string | null;
  workspaceIdentity?: string;
  isDesktop?: boolean;
}) {
  const { intl, locale } = useXCodeIntl();
  const {
    supportState,
    workspaceFilterMode,
    setWorkspaceFilterMode,
    hasCurrentWorkspaceFilter,
    range,
    setRange,
    limitInput,
    setLimitInput,
    scanLimit,
    candidates,
    selectedSessionIds,
    selectedCount,
    scanError,
    importError,
    lastImportResult,
    isScanning,
    isImporting,
    importProgress,
    scan,
    importSelectedSessions,
    toggleSessionSelection,
    selectAllSessions,
    clearSelectedSessions,
  } = useZCodeSessionMigration({
    workspacePath,
    workspaceIdentity,
    isDesktop,
  });

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  return (
    <div className="space-y-6">
      <Card className="border border-border bg-card py-0 shadow-none">
        <CardHeader className="border-b border-border">
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!supportState.supported || isScanning}
              onClick={() => {
                void scan();
              }}
            >
              {isScanning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="size-3.5" />
              )}
              {intl.formatMessage({ id: "settings.migration.zcode.scan" })}
            </Button>
          </CardAction>
          <div className="space-y-1">
            <CardTitle>{intl.formatMessage({ id: "settings.migration.zcode.filtersTitle" })}</CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: "settings.migration.zcode.filtersDescription" })}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="space-y-2">
              <div className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({ id: "settings.migration.workspaceFilterLabel" })}
              </div>
              <Select
                value={workspaceFilterMode}
                disabled={!supportState.supported || isScanning || isImporting}
                onValueChange={(value) =>
                  setWorkspaceFilterMode(value as ClaudeMigrationWorkspaceFilterMode)
                }
              >
                <SelectTrigger size="lg" className="w-full justify-between">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {intl.formatMessage({ id: "settings.migration.workspaceFilter.all" })}
                  </SelectItem>
                  {hasCurrentWorkspaceFilter ? (
                    <SelectItem value="current">
                      {intl.formatMessage({ id: "settings.migration.workspaceFilter.current" })}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({ id: "settings.migration.rangeLabel" })}
              </div>
              <Select
                value={range}
                disabled={!supportState.supported || isScanning || isImporting}
                onValueChange={(value) => setRange(value as (typeof RANGE_OPTIONS)[number])}
              >
                <SelectTrigger size="lg" className="w-full justify-between">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {intl.formatMessage({ id: `settings.migration.range.${option}` })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({ id: "settings.migration.limitLabel" })}
              </div>
              <Input
                type="number"
                min={1}
                max={500}
                value={limitInput}
                disabled={!supportState.supported || isScanning || isImporting}
                onChange={(event) => setLimitInput(event.target.value)}
              />
              <div className="text-ui-base text-foreground-subtle">
                {intl.formatMessage(
                  { id: "settings.migration.limitHint" },
                  { max: String(scanLimit) },
                )}
              </div>
            </div>
          </div>

          {scanError ? (
            <Alert>
              <TriangleAlert className="size-4" />
              <AlertTitle>
                {intl.formatMessage({ id: "settings.migration.scanFailedTitle" })}
              </AlertTitle>
              <AlertDescription>
                {intl.formatMessage(
                  { id: "settings.migration.zcode.scanFailedDescription" },
                  { error: scanError },
                )}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {isImporting ? (
        <Alert>
          <Loader2 className="size-4 animate-spin" />
          <AlertTitle>
            {intl.formatMessage({ id: "settings.migration.zcode.importingTitle" })}
          </AlertTitle>
          <AlertDescription>
            {importProgress
              ? intl.formatMessage(
                  { id: "settings.migration.zcode.importingProgress" },
                  {
                    processed: String(importProgress.processed),
                    total: String(importProgress.total),
                  },
                )
              : intl.formatMessage({ id: "settings.migration.zcode.importingPreparing" })}
          </AlertDescription>
        </Alert>
      ) : null}

      <MigrationCandidatesCard
        supportState={supportState}
        candidates={candidates}
        selectedSessionIds={selectedSessionIds}
        selectedCount={selectedCount}
        importError={importError}
        lastImportResult={lastImportResult}
        isImporting={isImporting}
        dateTimeFormatter={dateTimeFormatter}
        titleId="settings.migration.zcode.candidatesTitle"
        descriptionId="settings.migration.zcode.candidatesDescription"
        onToggleSelection={toggleSessionSelection}
        onSelectAll={selectAllSessions}
        onClearSelection={clearSelectedSessions}
        onImportSelected={() => {
          void importSelectedSessions();
        }}
      />
    </div>
  );
}
