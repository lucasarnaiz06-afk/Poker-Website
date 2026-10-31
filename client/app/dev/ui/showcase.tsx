"use client";

import { Bell, Bomb, Copy, LogOut, Plus, Settings, Trash2, User } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Alert,
  Avatar,
  AVATAR_PRESET_IDS,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Chips,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  InfoTip,
  Input,
  Kbd,
  NumberInput,
  Panel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
  Select,
  Sheet,
  SheetContent,
  SheetTrigger,
  Skeleton,
  SkeletonText,
  Slider,
  Stat,
  StatGroup,
  Switch,
  SwitchField,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  Tooltip,
  useTheme,
} from "@/components/ui";

function Demo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{title}</h2>
      <Panel className="flex flex-wrap items-center gap-3">{children}</Panel>
    </section>
  );
}

export function UiShowcase() {
  const { theme, toggleTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [num, setNum] = useState(40);
  const [slider, setSlider] = useState(25);
  const [seg, setSeg] = useState<"all" | "nlhe" | "plo">("all");
  const [select, setSelect] = useState("6max");
  const [checked, setChecked] = useState(true);
  const [compact, setCompact] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <Demo title="Theme">
        <Button variant="secondary" onClick={toggleTheme}>
          Switch to {theme === "dark" ? "light" : "dark"}
        </Button>
      </Demo>

      <Demo title="Button">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger" leftIcon={<Trash2 />}>
          Delete
        </Button>
        <Button size="sm">Small</Button>
        <Button size="lg" rightIcon={<Plus />}>
          Large
        </Button>
        <Button
          loading={loading}
          onClick={() => {
            setLoading(true);
            window.setTimeout(() => setLoading(false), 1500);
          }}
        >
          Click to load
        </Button>
        <Button disabled>Disabled</Button>
        <IconButton aria-label="Notifications">
          <Bell />
        </IconButton>
        <IconButton aria-label="Copy" variant="secondary" size="sm">
          <Copy />
        </IconButton>
      </Demo>

      <Demo title="Inputs">
        <div className="grid w-full gap-4 sm:grid-cols-2">
          <Field label="Name" hint="3-40 characters">
            <Input placeholder="Friday home game" />
          </Field>
          <Field label="With error" error="That name is taken.">
            <Input defaultValue="Taken" />
          </Field>
          <Field label="Buy-in" hint={`${num * 10} chips at 5/10`}>
            <NumberInput value={num} onChange={setNum} min={20} max={500} step={10} suffix="BB" />
          </Field>
          <Field label="Table size">
            <Select
              value={select}
              onValueChange={setSelect}
              options={[
                { value: "hu", label: "Heads-up", description: "2 seats" },
                { value: "6max", label: "6-max", description: "6 seats" },
                { value: "full", label: "Full ring", description: "9 seats" },
              ]}
            />
          </Field>
          <Field label="Bio" optional className="sm:col-span-2">
            <Textarea placeholder="Tell people about your game" />
          </Field>
        </div>
      </Demo>

      <Demo title="Switch, slider, segmented">
        <div className="flex w-full flex-col gap-5">
          <div className="flex items-center gap-3">
            <Switch checked={checked} onCheckedChange={setChecked} aria-label="Demo switch" />
            <Switch size="sm" defaultChecked aria-label="Small switch" />
          </div>
          <SwitchField
            label="Bomb pots"
            description="Everyone antes, no preflop betting, straight to the flop."
            labelAside={<InfoTip label="About bomb pots">A longer explanation lives here.</InfoTip>}
            defaultChecked
          />
          <div className="flex max-w-sm flex-col gap-2">
            <span className="text-[13px] text-muted">Time to act: {slider}s</span>
            <Slider value={slider} onValueChange={setSlider} min={10} max={120} step={5} aria-label="Time to act" />
          </div>
          <Segmented
            aria-label="Game"
            value={seg}
            onValueChange={setSeg}
            options={[
              { value: "all", label: "All" },
              { value: "nlhe", label: "Hold'em" },
              { value: "plo", label: "Omaha" },
            ]}
          />
        </div>
      </Demo>

      <Demo title="Tabs">
        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="hands">Hands</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <p className="text-sm text-muted">Overview content.</p>
          </TabsContent>
          <TabsContent value="hands">
            <p className="text-sm text-muted">Hands content.</p>
          </TabsContent>
          <TabsContent value="settings">
            <p className="text-sm text-muted">Settings content.</p>
          </TabsContent>
        </Tabs>
      </Demo>

      <Demo title="Overlays">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Dialog</Button>
          </DialogTrigger>
          <DialogContent
            title="Leave table?"
            description="Your stack goes back to your wallet."
            size="sm"
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="danger">Leave</Button>
                </DialogClose>
              </>
            }
          >
            <p className="text-sm text-muted">Destructive actions always confirm.</p>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">Sheet</Button>
          </SheetTrigger>
          <SheetContent title="Table chat">
            <p className="text-sm text-muted">Side panel content.</p>
          </SheetContent>
        </Sheet>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Signed in as lucas</DropdownMenuLabel>
            <DropdownMenuItem icon={<User />}>Profile</DropdownMenuItem>
            <DropdownMenuItem icon={<Settings />} shortcut="⌘,">
              Settings
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={compact} onCheckedChange={(value) => setCompact(value === true)}>
              Compact mode
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<LogOut />} tone="danger">
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip content="Copies the invite link">
          <Button variant="secondary">Tooltip</Button>
        </Tooltip>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">Popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="font-medium">Popover</p>
            <p className="mt-1 text-muted">Click outside or press Esc to close.</p>
          </PopoverContent>
        </Popover>
        <Button
          variant="secondary"
          onClick={() =>
            toast({ title: "Invite link copied", tone: "success", description: "Send it to your friends." })
          }
        >
          Toast
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({ title: "Couldn't join", tone: "error", action: { label: "Retry", onClick: () => undefined } })
          }
        >
          Error toast
        </Button>
      </Demo>

      <Demo title="Badge, Kbd">
        <Badge>Neutral</Badge>
        <Badge tone="accent">Your turn</Badge>
        <Badge tone="gold">Winner</Badge>
        <Badge tone="danger" icon={<Bomb />}>
          Bomb pot
        </Badge>
        <Badge tone="warning">Away</Badge>
        <Badge tone="info">Nit</Badge>
        <Badge tone="outline" size="md">
          Outline
        </Badge>
        <span className="flex items-center gap-1 text-sm text-muted">
          <Kbd>F</Kbd> fold <Kbd>C</Kbd> call <Kbd>R</Kbd> raise <Kbd>Esc</Kbd>
        </span>
      </Demo>

      <Demo title="Chips, Stat">
        <Chips amount={1234567} />
        <Chips amount={1234567} compact icon />
        <Chips amount={400} bigBlind={10} showBB />
        <Chips amount={400} bigBlind={10} bbOnly />
        <Chips amount={250} signed />
        <Chips amount={-90} signed />
        <StatGroup className="w-full">
          <Stat label="Net won" value={<Chips amount={12850} signed />} delta={{ value: "+8%", direction: "up" }} />
          <Stat label="Hands" value="1,204" />
          <Stat label="VPIP" value="24%" hint="Last 30 days" />
          <Stat label="Win rate" value="6.2 BB/100" delta={{ value: "−1.1", direction: "down" }} />
        </StatGroup>
      </Demo>

      <Demo title="Avatar">
        <Avatar name="Lucas Arnaiz" seed="u1" size="xs" />
        <Avatar name="Lucas Arnaiz" seed="u1" size="sm" />
        <Avatar name="Mia" seed="u2" size="md" />
        <Avatar name="Sam Lee" avatar={AVATAR_PRESET_IDS[3]} size="lg" />
        <Avatar name="Alex" avatar={AVATAR_PRESET_IDS[9]} size="xl" />
      </Demo>

      <Demo title="Alert">
        <div className="flex w-full flex-col gap-2">
          <Alert tone="info" title="Heads up">
            Bomb pot next hand.
          </Alert>
          <Alert tone="success">You won 1,250 chips.</Alert>
          <Alert tone="warning">Connection is unstable.</Alert>
          <Alert tone="danger" title="Couldn't join">
            That password is incorrect.
          </Alert>
        </div>
      </Demo>

      <Demo title="Card, Table, Skeleton, Empty state">
        <div className="grid w-full gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Recent hands"
              description="Last 3 hands"
              actions={
                <Button size="sm" variant="ghost">
                  View all
                </Button>
              }
            />
            <Table>
              <THead>
                <tr>
                  <TH className="pl-5">Hand</TH>
                  <TH>Result</TH>
                  <TH numeric className="pr-5">
                    Net
                  </TH>
                </tr>
              </THead>
              <TBody>
                {[
                  ["#1042", "Won at showdown", 340],
                  ["#1041", "Folded preflop", -10],
                  ["#1040", "Bomb pot", -120],
                ].map(([hand, result, net]) => (
                  <TR key={hand as string} interactive>
                    <TD className="pl-5 font-mono text-[13px]">{hand}</TD>
                    <TD className="text-muted">{result}</TD>
                    <TD numeric className="pr-5">
                      <Chips amount={net as number} signed />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <CardFooter>
              <Button size="sm" variant="secondary">
                Export
              </Button>
            </CardFooter>
          </Card>
          <Card>
            <CardHeader title="Loading" />
            <CardBody className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <SkeletonText lines={2} className="flex-1" />
              </div>
              <Skeleton className="h-24 w-full" />
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <EmptyState
              icon={<Bomb />}
              title="No hands yet"
              description="Play a few hands and they'll show up here."
              action={<Button>Find a table</Button>}
            />
          </Card>
        </div>
      </Demo>
    </div>
  );
}
