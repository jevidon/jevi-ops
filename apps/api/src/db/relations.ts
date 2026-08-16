// Relation keys are load-bearing: they were the PostgREST embed aliases, and
// db.query.<table>.findMany({ with: { <key>: ... } }) surfaces them verbatim
// in JSON responses the web app consumes. Renaming a key changes the API shape.
import { relations } from "drizzle-orm/relations";
import { stewardship_domains, projects, people, person_facts, person_interactions, milestones, activity_log, project_checklist_items, content_items, content_checklist_items, tasks, checklist_templates, checklist_instances, books, quotes, quote_annotations, journal_books, journal_entries, notes, observations, routines, routine_completions, health_visits, health_metrics, lab_panels, lab_results, health_documents, companies, conversations, project_contacts, shopping_lists, shopping_items, shopping_purchases } from "./schema.js";

export const projectsRelations = relations(projects, ({one, many}) => ({
	domain: one(stewardship_domains, {
		fields: [projects.domain_id],
		references: [stewardship_domains.id]
	}),
	primary_contact: one(people, {
		fields: [projects.primary_contact_id],
		references: [people.id]
	}),
	company: one(companies, {
		fields: [projects.company_id],
		references: [companies.id]
	}),
	contacts: many(project_contacts),
	milestones: many(milestones),
	activity_log: many(activity_log),
	project_checklist_items: many(project_checklist_items),
	tasks: many(tasks),
	notes: many(notes),
	observations: many(observations),
}));

export const stewardship_domainsRelations = relations(stewardship_domains, ({many}) => ({
	projects: many(projects),
	content_items: many(content_items),
	tasks: many(tasks),
	checklist_templates: many(checklist_templates),
	observations: many(observations),
}));

export const peopleRelations = relations(people, ({one, many}) => ({
	projects: many(projects),
	facts: many(person_facts),
	interactions: many(person_interactions),
	conversations: many(conversations),
	company_ref: one(companies, {
		fields: [people.company_id],
		references: [companies.id]
	}),
	notes: many(notes),
}));

// ─── CRM module (0041-0043) ──────────────────────────────────────────────

export const companiesRelations = relations(companies, ({one, many}) => ({
	domain: one(stewardship_domains, {
		fields: [companies.domain_id],
		references: [stewardship_domains.id]
	}),
	contacts: many(people),
	projects: many(projects),
	conversations: many(conversations),
}));

export const conversationsRelations = relations(conversations, ({one}) => ({
	company: one(companies, {
		fields: [conversations.company_id],
		references: [companies.id]
	}),
	person: one(people, {
		fields: [conversations.person_id],
		references: [people.id]
	}),
	project: one(projects, {
		fields: [conversations.project_id],
		references: [projects.id]
	}),
	task: one(tasks, {
		fields: [conversations.task_id],
		references: [tasks.id]
	}),
}));

export const project_contactsRelations = relations(project_contacts, ({one}) => ({
	project: one(projects, {
		fields: [project_contacts.project_id],
		references: [projects.id]
	}),
	person: one(people, {
		fields: [project_contacts.person_id],
		references: [people.id]
	}),
}));

export const person_factsRelations = relations(person_facts, ({one}) => ({
	person: one(people, {
		fields: [person_facts.person_id],
		references: [people.id]
	}),
}));

export const person_interactionsRelations = relations(person_interactions, ({one}) => ({
	person: one(people, {
		fields: [person_interactions.person_id],
		references: [people.id]
	}),
}));

export const milestonesRelations = relations(milestones, ({one}) => ({
	project: one(projects, {
		fields: [milestones.project_id],
		references: [projects.id]
	}),
}));

export const activity_logRelations = relations(activity_log, ({one}) => ({
	project: one(projects, {
		fields: [activity_log.project_id],
		references: [projects.id]
	}),
}));

export const project_checklist_itemsRelations = relations(project_checklist_items, ({one}) => ({
	project: one(projects, {
		fields: [project_checklist_items.project_id],
		references: [projects.id]
	}),
}));

export const content_itemsRelations = relations(content_items, ({one, many}) => ({
	domain: one(stewardship_domains, {
		fields: [content_items.domain_id],
		references: [stewardship_domains.id]
	}),
	parent: one(content_items, {
		fields: [content_items.parent_id],
		references: [content_items.id],
		relationName: "content_items_parent_id_content_items_id"
	}),
	derivatives: many(content_items, {
		relationName: "content_items_parent_id_content_items_id"
	}),
	content_checklist_items: many(content_checklist_items),
	tasks: many(tasks),
}));

export const content_checklist_itemsRelations = relations(content_checklist_items, ({one}) => ({
	content_item: one(content_items, {
		fields: [content_checklist_items.content_item_id],
		references: [content_items.id]
	}),
}));

export const tasksRelations = relations(tasks, ({one, many}) => ({
	project: one(projects, {
		fields: [tasks.project_id],
		references: [projects.id]
	}),
	parent_task: one(tasks, {
		fields: [tasks.parent_task_id],
		references: [tasks.id],
		relationName: "tasks_parent_task_id_tasks_id"
	}),
	subtasks: many(tasks, {
		relationName: "tasks_parent_task_id_tasks_id"
	}),
	content_item: one(content_items, {
		fields: [tasks.content_item_id],
		references: [content_items.id]
	}),
	domain: one(stewardship_domains, {
		fields: [tasks.domain_id],
		references: [stewardship_domains.id]
	}),
}));

export const checklist_instancesRelations = relations(checklist_instances, ({one}) => ({
	checklist_template: one(checklist_templates, {
		fields: [checklist_instances.template_id],
		references: [checklist_templates.id]
	}),
}));

export const checklist_templatesRelations = relations(checklist_templates, ({one, many}) => ({
	checklist_instances: many(checklist_instances),
	domain: one(stewardship_domains, {
		fields: [checklist_templates.domain_id],
		references: [stewardship_domains.id]
	}),
}));

export const quotesRelations = relations(quotes, ({one, many}) => ({
	book: one(books, {
		fields: [quotes.book_id],
		references: [books.id]
	}),
	annotations: many(quote_annotations),
	notes: many(notes),
}));

export const booksRelations = relations(books, ({many}) => ({
	quotes: many(quotes),
}));

export const quote_annotationsRelations = relations(quote_annotations, ({one}) => ({
	quote: one(quotes, {
		fields: [quote_annotations.quote_id],
		references: [quotes.id]
	}),
}));

export const journal_entriesRelations = relations(journal_entries, ({one}) => ({
	book: one(journal_books, {
		fields: [journal_entries.book_id],
		references: [journal_books.id]
	}),
}));

export const journal_booksRelations = relations(journal_books, ({many}) => ({
	journal_entries: many(journal_entries),
}));

export const notesRelations = relations(notes, ({one}) => ({
	quote: one(quotes, {
		fields: [notes.related_quote_id],
		references: [quotes.id]
	}),
	project: one(projects, {
		fields: [notes.related_project_id],
		references: [projects.id]
	}),
	person: one(people, {
		fields: [notes.related_person_id],
		references: [people.id]
	}),
}));

export const observationsRelations = relations(observations, ({one}) => ({
	domain: one(stewardship_domains, {
		fields: [observations.domain_id],
		references: [stewardship_domains.id]
	}),
	project: one(projects, {
		fields: [observations.project_id],
		references: [projects.id]
	}),
}));

export const routine_completionsRelations = relations(routine_completions, ({one}) => ({
	routine: one(routines, {
		fields: [routine_completions.routine_id],
		references: [routines.id]
	}),
}));

export const routinesRelations = relations(routines, ({many}) => ({
	completions: many(routine_completions),
}));

// ─── Shopping module (0044) ──────────────────────────────────────────────

export const shopping_listsRelations = relations(shopping_lists, ({many}) => ({
	items: many(shopping_items),
}));

export const shopping_itemsRelations = relations(shopping_items, ({one, many}) => ({
	list: one(shopping_lists, {
		fields: [shopping_items.list_id],
		references: [shopping_lists.id]
	}),
	purchases: many(shopping_purchases),
}));

export const shopping_purchasesRelations = relations(shopping_purchases, ({one}) => ({
	item: one(shopping_items, {
		fields: [shopping_purchases.item_id],
		references: [shopping_items.id]
	}),
}));

export const health_metricsRelations = relations(health_metrics, ({one}) => ({
	health_visit: one(health_visits, {
		fields: [health_metrics.visit_id],
		references: [health_visits.id]
	}),
}));

export const health_visitsRelations = relations(health_visits, ({many}) => ({
	health_metrics: many(health_metrics),
	lab_panels: many(lab_panels),
	health_documents: many(health_documents),
}));

export const lab_panelsRelations = relations(lab_panels, ({one, many}) => ({
	health_visit: one(health_visits, {
		fields: [lab_panels.visit_id],
		references: [health_visits.id]
	}),
	results: many(lab_results),
	health_documents: many(health_documents),
}));

export const lab_resultsRelations = relations(lab_results, ({one}) => ({
	panel: one(lab_panels, {
		fields: [lab_results.panel_id],
		references: [lab_panels.id]
	}),
}));

export const health_documentsRelations = relations(health_documents, ({one}) => ({
	health_visit: one(health_visits, {
		fields: [health_documents.visit_id],
		references: [health_visits.id]
	}),
	lab_panel: one(lab_panels, {
		fields: [health_documents.panel_id],
		references: [lab_panels.id]
	}),
}));