import { type Node } from '@xyflow/react';
import {
  Database,
  Link,
  Filter,
  LayoutList,
  Rows4,
  ArrowUpDown,
  Repeat,
  Trash2,
  SquarePlus,
  Pencil,
  Scissors,
  GitMerge,
  PenLine,
  CornerDownLeft,
  Settings,
  Hammer,
  Columns3,
  Crosshair,
  X,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import styles from './NodeDetailsPanel.module.css';

// ── Icon map (mirrors SqlNode) ──

const kindIcons: Record<string, LucideIcon> = {
  table: Database,
  join: Link,
  where: Filter,
  having: Filter,
  select: LayoutList,
  groupby: Rows4,
  orderby: ArrowUpDown,
  limit: Scissors,
  cte: Repeat,
  union: GitMerge,
  values: Database,
  insert: SquarePlus,
  update: Pencil,
  delete: Trash2,
  create: Hammer,
  column: Columns3,
  set: PenLine,
  returning: CornerDownLeft,
  operation: Settings,
  target: Crosshair,
};

// ── Encyclopedia: standard definitions + docs ──

interface EncyclopediaEntry {
  title: string;
  definition: string;
  docsUrl: string;
}

const encyclopedia: Record<string, EncyclopediaEntry> = {
  table: {
    title: 'FROM (Table Source)',
    definition:
      'The FROM clause specifies the source table(s) from which data is retrieved. It is the starting point of any query — all subsequent operations act on this data.',
    docsUrl: 'https://www.postgresql.org/docs/current/sql-select.html#SQL-FROM',
  },
  join: {
    title: 'JOIN',
    definition:
      'A JOIN clause combines rows from two or more tables based on a related column. The type of join (INNER, LEFT, RIGHT, FULL) determines which unmatched rows are included.',
    docsUrl:
      'https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-JOIN',
  },
  where: {
    title: 'WHERE (Filter)',
    definition:
      'The WHERE clause filters individual rows before any grouping occurs. Only rows satisfying the boolean condition pass through to the next step.',
    docsUrl: 'https://www.postgresql.org/docs/current/sql-select.html#SQL-WHERE',
  },
  having: {
    title: 'HAVING (Group Filter)',
    definition:
      'The HAVING clause filters groups after GROUP BY has been applied. It is used to discard entire groups that do not meet an aggregate condition.',
    docsUrl:
      'https://www.postgresql.org/docs/current/sql-select.html#SQL-HAVING',
  },
  select: {
    title: 'SELECT (Projection)',
    definition:
      'The SELECT clause defines which columns or expressions appear in the output. It can rename columns with aliases and compute derived values.',
    docsUrl:
      'https://www.postgresql.org/docs/current/sql-select.html#SQL-SELECT-LIST',
  },
  groupby: {
    title: 'GROUP BY (Aggregation)',
    definition:
      'GROUP BY collapses rows sharing the same values in the specified columns into summary rows. Aggregate functions (SUM, COUNT, AVG) then operate on each group.',
    docsUrl:
      'https://www.postgresql.org/docs/current/sql-select.html#SQL-GROUPBY',
  },
  orderby: {
    title: 'ORDER BY (Sort)',
    definition:
      'ORDER BY sorts the result set by one or more columns in ascending (ASC) or descending (DESC) order. Without it, row order is not guaranteed.',
    docsUrl:
      'https://www.postgresql.org/docs/current/sql-select.html#SQL-ORDERBY',
  },
  limit: {
    title: 'LIMIT (Row Cap)',
    definition:
      'LIMIT restricts the number of rows returned by the query. Combined with OFFSET, it enables pagination through large result sets.',
    docsUrl:
      'https://www.postgresql.org/docs/current/sql-select.html#SQL-LIMIT',
  },
  cte: {
    title: 'WITH / CTE',
    definition:
      'A Common Table Expression (CTE) defines a temporary, named result set that exists only for the duration of the query. It improves readability and allows recursive patterns.',
    docsUrl:
      'https://www.postgresql.org/docs/current/queries-with.html',
  },
  union: {
    title: 'UNION / Set Operation',
    definition:
      'UNION combines the results of two SELECT statements into a single result set. UNION removes duplicates; UNION ALL keeps them. INTERSECT and EXCEPT are related set operations.',
    docsUrl:
      'https://www.postgresql.org/docs/current/queries-union.html',
  },
  insert: {
    title: 'INSERT',
    definition:
      'INSERT adds new rows to a table from literal VALUES or from the results of a SELECT query. It can target specific columns or use defaults.',
    docsUrl: 'https://www.postgresql.org/docs/current/sql-insert.html',
  },
  update: {
    title: 'UPDATE',
    definition:
      'UPDATE modifies the values of existing rows in a table. A WHERE clause limits which rows are affected; without it, all rows are updated.',
    docsUrl: 'https://www.postgresql.org/docs/current/sql-update.html',
  },
  delete: {
    title: 'DELETE',
    definition:
      'DELETE removes rows from a table. A WHERE clause specifies which rows to remove; without it, all rows are deleted.',
    docsUrl: 'https://www.postgresql.org/docs/current/sql-delete.html',
  },
  values: {
    title: 'VALUES (Literal Data)',
    definition:
      'A VALUES clause provides explicit row data as literal constants. It is commonly used inside INSERT statements to supply new rows.',
    docsUrl:
      'https://www.postgresql.org/docs/current/sql-values.html',
  },
  set: {
    title: 'SET (Assignment)',
    definition:
      'The SET clause in an UPDATE statement specifies which columns to modify and their new values. Expressions can reference the current row.',
    docsUrl: 'https://www.postgresql.org/docs/current/sql-update.html',
  },
  returning: {
    title: 'RETURNING',
    definition:
      'The RETURNING clause causes INSERT, UPDATE, or DELETE to return the affected rows (or specific columns), avoiding the need for a separate SELECT.',
    docsUrl:
      'https://www.postgresql.org/docs/current/dml-returning.html',
  },
  create: {
    title: 'CREATE TABLE',
    definition:
      'CREATE TABLE defines a new table in the database with a specified set of columns, data types, and constraints.',
    docsUrl:
      'https://www.postgresql.org/docs/current/sql-createtable.html',
  },
  column: {
    title: 'Column Definition',
    definition:
      'A column definition specifies the name, data type, and optional constraints (NOT NULL, DEFAULT, PRIMARY KEY) for a single column.',
    docsUrl:
      'https://www.postgresql.org/docs/current/sql-createtable.html',
  },
  operation: {
    title: 'SQL Operation',
    definition:
      'A general SQL statement that modifies schema or data. Refer to the PostgreSQL documentation for details on this specific operation.',
    docsUrl: 'https://www.postgresql.org/docs/current/sql-commands.html',
  },
};

// ── Detailed contextual explanation ──

function generateDetailedContext(kind: string, label: string): string {
  switch (kind) {
    case 'table': {
      if (label === '(no source)') return 'No explicit data source is specified. The query generates data without reading from a table.';
      if (label.startsWith('subquery'))
        return 'This step loads data from an inline subquery — a full query nested inside the FROM clause that acts as a virtual table.';
      const name = label.replace(/\s*\(.*\)$/, '').trim();
      return `This step reads all rows from the \`${name}\` table into the pipeline. This is the raw, unfiltered dataset that subsequent operations will process.`;
    }
    case 'where': {
      const cond = label.replace(/^WHERE\s+/i, '');
      return `This step filters the incoming data, keeping only the rows where \`${cond}\`. Rows that do not satisfy this condition are discarded before reaching the next operation.`;
    }
    case 'having': {
      const cond = label.replace(/^HAVING\s+/i, '');
      return `After grouping, this step discards any groups where \`${cond}\` is not satisfied. Only groups that pass this aggregate condition remain.`;
    }
    case 'join': {
      if (label.includes('CROSS'))
        return 'This step produces a Cartesian product — every row from the left source is paired with every row from the right source. The result set can be very large.';
      const onMatch = label.match(/ON\s+(.+)/i);
      const joinType = label.match(/^(\w+\s+JOIN)/i)?.[1] ?? 'JOIN';
      if (onMatch)
        return `This \`${joinType}\` combines rows from two tables, matching them where \`${onMatch[1]}\`. Rows without a match are handled according to the join type.`;
      return 'This step combines rows from two data sources based on a matching condition.';
    }
    case 'select': {
      const cols = label.replace(/^SELECT\s+/i, '');
      if (cols === '*') return 'This step passes through all available columns from the preceding operations without transformation.';
      return `This step shapes the output by selecting specific columns: \`${cols}\`. Any columns not listed here are dropped from the result.`;
    }
    case 'groupby': {
      const cols = label.replace(/^GROUP BY\s+/i, '');
      return `This step collapses rows that share the same values in \`${cols}\` into summary rows. Aggregate functions (SUM, COUNT, AVG) can then calculate totals for each group.`;
    }
    case 'orderby': {
      const cols = label.replace(/^ORDER BY\s+/i, '');
      return `This step sorts the entire result set by \`${cols}\`. Without this step, the database does not guarantee any particular row order.`;
    }
    case 'limit': {
      const val = label.replace(/^LIMIT\s+/i, '');
      return `This step caps the output to \`${val}\` rows. Combined with ORDER BY, this is commonly used for "top N" queries or pagination.`;
    }
    case 'cte': {
      const name = label.replace(/^(CTE|RECURSIVE):\s*/i, '').trim();
      const isRecursive = label.startsWith('RECURSIVE');
      if (isRecursive)
        return `This defines \`${name}\` as a recursive CTE. It starts with a base case, then repeatedly applies the recursive step until no new rows are produced.`;
      return `This defines \`${name}\` as a temporary result set (CTE) available to the main query. Think of it as a named subquery that can be referenced multiple times.`;
    }
    case 'union':
      return label.includes('ALL')
        ? 'This step stacks the results of two queries on top of each other, keeping all rows including duplicates. Both queries must produce the same number of columns.'
        : 'This step combines the results of two queries into one, automatically removing any duplicate rows. Both queries must produce the same number of columns.';
    case 'insert':
      return 'This step takes the incoming rows and writes them as new records into the target table.';
    case 'update': {
      const table = label.replace(/^UPDATE\s+/i, '');
      return `This step modifies existing rows in the \`${table}\` table. Only rows that passed the preceding filters will be updated.`;
    }
    case 'delete': {
      const table = label.replace(/^DELETE FROM\s+/i, '');
      return `This step permanently removes the matched rows from the \`${table}\` table. Only rows that passed the preceding filters are deleted.`;
    }
    case 'values':
      return 'This step provides explicit, hard-coded data values as input rows. These literal values feed directly into the next operation (usually INSERT).';
    case 'set': {
      const assignments = label.replace(/^SET\s+/i, '');
      return `This step assigns new values to columns: \`${assignments}\`. Each assignment modifies a specific column on every matched row.`;
    }
    case 'returning': {
      const cols = label.replace(/^RETURNING\s+/i, '');
      return `After modifying the data, this step returns \`${cols}\` from the affected rows — avoiding the need for a separate SELECT query.`;
    }
    case 'create': {
      const name = label.replace(/^CREATE TABLE\s+/i, '');
      return `This step creates a new table named \`${name}\` in the database with the specified column definitions and constraints.`;
    }
    case 'column':
      return `This defines the \`${label.trim()}\` column within the table, including its data type and any constraints.`;
    default:
      return `This step performs a \`${label || kind}\` operation on the data.`;
  }
}

// ── Render backtick-wrapped terms as styled <code> elements ──

function renderWithCode(text: string) {
  const parts = text.split(/(`[^`]+`)/);
  return parts.map((part, i) =>
    part.startsWith('`') && part.endsWith('`')
      ? <code key={i} className={styles.inlineCode}>{part.slice(1, -1)}</code>
      : part,
  );
}

// ── Panel component ──

interface Props {
  node: Node;
  onClose: () => void;
}

export default function NodeDetailsPanel({ node, onClose }: Props) {
  const kind = (node.data.kind as string) ?? 'operation';
  const label = node.data.label as string;
  const Icon = kindIcons[kind] ?? Settings;
  const entry = encyclopedia[kind] ?? encyclopedia.operation;
  const context = generateDetailedContext(kind, label);
  const color = `var(--node-color, #58a6ff)`;

  return (
    <div className={styles.panel}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Icon size={18} style={{ color, flexShrink: 0 }} />
          <span className={styles.operationName}>{entry.title}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close panel">
          <X size={16} />
        </button>
      </div>

      {/* ── Raw SQL ── */}
      <div className={styles.rawSql}>{label}</div>

      {/* ── Encyclopedia ── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Definition</h3>
        <p className={styles.sectionBody}>{entry.definition}</p>
        <a
          href={entry.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.docsLink}
        >
          <ExternalLink size={12} />
          PostgreSQL Docs
        </a>
      </section>

      {/* ── Contextual Explanation ── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>In this query</h3>
        <p className={styles.sectionBody}>{renderWithCode(context)}</p>
      </section>
    </div>
  );
}
