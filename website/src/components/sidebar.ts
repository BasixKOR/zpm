export type SidebarLink = {
  label: string;
  href: string;
  active?: boolean;
  sub?: boolean;
  section?: boolean;
};

export type SidebarSubtitle = {
  subtitle: string;
};

export type SidebarItem = SidebarLink | SidebarSubtitle;

export interface SidebarGroup {
  title: string;
  items: SidebarItem[];
}
