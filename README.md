# 🧠 (No name for now) — Intelligent RAG System with Cross-Document Contradiction Detection

> A Retrieval-Augmented Generation platform for building document knowledge bases with a core focus on **simultaneous multi-document comparison** and **automatic contradiction discovery**.

---

# Table of Contents

- [Project Overview](#project-overview)
- [Key Features](#key-features)
- [Use Cases](#use-cases)
- [High-level Architecture](#high-level-architecture)
- [System Workflow](#system-workflow)
- [Comparison & Contradiction Engine](#comparison--contradiction-engine)
- [Database Design](#database-design)
- [Core Components](#core-components)
- [API Design](#api-design)
- [Data Model](#data-model)
- [Technology Stack](#technology-stack)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the System](#running-the-system)
- [Example Flows](#example-flows)
- [Scalability & Performance](#scalability--performance)
- [Security Considerations](#security-considerations)
- [Limitations](#limitations)

---

# Project Overview

This project is basically a RAG system for semantic storage of knowledge bases. It provides functionality of adding, vieweing and removing files (PDF, DOCX, TXT) from the system (knowledge base). Once files are added, you can ask the system various question about the content of the whole knowledge base. You can also search for contradictions between contents of any given file and any group of other files (including the entire knowledge base).

# Key Features

- Adding, removing, and viewing documents in a centralized knowledge base  
- Asking natural-language questions about the knowledge base and receiving valid answers and explanations  
- Semantic cross-document comparison with automatic contradiction and inconsistency discovery  

# Use Cases

- **AI-Augmented Documentation Systems** <br>
Build intelligent documentation portals where users can ask questions about internal knowledge and verify whether documents agree or conflict on specific topics.

- **Enterprise Knowledge Base Validation** <br>
Automatically detect contradictions between internal documents such as policies, technical standards, onboarding materials, and operational guidelines to maintain a consistent and reliable corporate knowledge base.

- **Scientific & Research Literature Analysis** <br>
Compare research papers, reports, and experimental documentation to identify conflicting statements, incompatible assumptions, or evolving conclusions across large corpora.

- **Legal & Compliance Document Review** <br>
Analyze contracts, regulations, and internal compliance documents to discover logical conflicts, outdated clauses, and policy mismatches.

- **Regulatory Monitoring & Policy Tracking** <br>
Continuously compare new documents against an existing knowledge base to detect when new regulations or updates contradict established rules or prior versions.

 

# High-level Architecture

Here is the high-level design schema.

!['high level design'](./design.png)

# System Workflow

!['uml sequence'](./uml_sequence.png)


# Comparison & Contradiction Engine 


# Database Design

!['database schema'](./knowledge_db/ERD.png)

# Core Components

## API Gateway

## [Document Ingestion / Parsing Service](./document_parsing_service/)

This service is responsible for accepting raw document files (PDF, DOCX, TXT, etc.) and extracting their textual and structural content. <br>
We use [Docling Serve](https://github.com/docling-project/docling-serve) as the ingestion backend. It provides an HTTP API on top of [Docling](https://github.com/docling-project/docling), a modern Python library for high-quality document parsing and structured text extraction. <br>
Docling Serve allows us to reliably transform real-world documents into clean, structured text representations that can be directly used by downstream components for chunking, embedding, retrieval, and contradiction analysis.

## Embedding & Indexing Service

gRPC server for embedding functions.

## Knowledge Database

## Comparison Engine

## LLM Orchestrator


## Async Task Processor

## Client Applications

# API Design

# Data Model

# Technology Stack

# Installation

# Configuration


# Running the System

# Example Flows

## Upload and Index Documents

## Run Cross-Document Comparison

## Query the Knowledge Base

# Scalability & Performance

# Security Considerations

# Limitations
